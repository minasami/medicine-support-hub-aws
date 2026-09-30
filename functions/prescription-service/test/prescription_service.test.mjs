// test/prescription_service.test.mjs
// Comprehensive Unit & Multi-Worker Concurrency Test Suite
// Verifies all security requirements, database-enforced mutex locks, atomic image claims,
// fail-closed rollbacks, access quarantine, and state transitions in complete isolation.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPrescriptionHandler, VALID_TRANSITIONS, REQUIRED_ENV_VARS } from '../src/main.js';

const TEST_ENV = {
  DATABASE_ID: 'test_db_isolated',
  MANAGEMENT_TEAM_ID: 'test_mgmt_team',
  PRESCRIPTIONS_COLLECTION_ID: 'test_prescriptions',
  ITEMS_COLLECTION_ID: 'test_prescription_items',
  PHARMACIES_COLLECTION_ID: 'test_pharmacies',
  STORAGE_BUCKET_ID: 'test_storage_bucket',
  APPWRITE_API_KEY: 'test_privileged_api_key',
  APPWRITE_FUNCTION_PROJECT_ID: 'test_project_isolated',
  APPWRITE_FUNCTION_API_ENDPOINT: 'https://fra.cloud.appwrite.io/v1',
};

function createMockSdkState() {
  const store = {
    documents: new Map(),
    files: new Map(),
    memberships: new Map(),
    callerAccount: null,
    timeCounter: 1000,
  };

  class MockDatabases {
    async getDocument(dbId, colId, docId) {
      const key = `${dbId}:${colId}:${docId}`;
      if (!store.documents.has(key)) {
        const err = new Error(`Document not found: ${docId}`);
        err.code = 404;
        throw err;
      }
      return JSON.parse(JSON.stringify(store.documents.get(key)));
    }

    async createDocument(dbId, colId, docId, data, permissions = []) {
      const key = `${dbId}:${colId}:${docId}`;
      if (store.documents.has(key)) {
        const err = new Error(`Document with the requested ID already exists: ${docId}`);
        err.code = 409;
        throw err;
      }
      store.timeCounter += 10;
      const timestamp = new Date(Date.now() + store.timeCounter).toISOString();
      const doc = {
        $id: docId,
        $permissions: permissions,
        $createdAt: timestamp,
        $updatedAt: timestamp,
        ...data,
      };
      store.documents.set(key, doc);
      return JSON.parse(JSON.stringify(doc));
    }

    async updateDocument(dbId, colId, docId, data, permissions) {
      const key = `${dbId}:${colId}:${docId}`;
      if (!store.documents.has(key)) {
        const err = new Error(`Document not found for update: ${docId}`);
        err.code = 404;
        throw err;
      }
      const existing = store.documents.get(key);
      store.timeCounter += 10;
      const timestamp = new Date(Date.now() + store.timeCounter).toISOString();
      const updated = {
        ...existing,
        ...data,
        $permissions: permissions !== undefined ? permissions : existing.$permissions,
        $updatedAt: timestamp,
      };
      store.documents.set(key, updated);
      return JSON.parse(JSON.stringify(updated));
    }

    async deleteDocument(dbId, colId, docId) {
      const key = `${dbId}:${colId}:${docId}`;
      if (!store.documents.has(key)) {
        const err = new Error(`Document not found for delete: ${docId}`);
        err.code = 404;
        throw err;
      }
      store.documents.delete(key);
      return { ok: true };
    }

    async listDocuments(dbId, colId, queries = []) {
      const docs = [];
      const prefix = `${dbId}:${colId}:`;
      for (const [key, doc] of store.documents.entries()) {
        if (key.startsWith(prefix)) {
          docs.push(JSON.parse(JSON.stringify(doc)));
        }
      }

      let filtered = docs;
      for (const q of queries) {
        if (q.method === 'equal') {
          filtered = filtered.filter((d) => d[q.attribute] === q.value);
        }
      }

      const limitQ = queries.find((q) => q.method === 'limit');
      const offsetQ = queries.find((q) => q.method === 'offset');
      const limit = limitQ ? limitQ.value : 50;
      const offset = offsetQ ? offsetQ.value : 0;

      const paged = filtered.slice(offset, offset + limit);
      return { total: filtered.length, documents: paged };
    }
  }

  class MockStorage {
    async getFile(bucketId, fileId) {
      const key = `${bucketId}:${fileId}`;
      if (!store.files.has(key)) {
        const err = new Error(`File not found: ${fileId}`);
        err.code = 404;
        throw err;
      }
      return JSON.parse(JSON.stringify(store.files.get(key)));
    }
  }

  class MockTeams {
    async listMemberships(teamId, queries = []) {
      const members = store.memberships.get(teamId) || [];
      const limitQ = queries.find((q) => q.method === 'limit');
      const offsetQ = queries.find((q) => q.method === 'offset');
      const limit = limitQ ? limitQ.value : 50;
      const offset = offsetQ ? offsetQ.value : 0;
      const paged = members.slice(offset, offset + limit);
      return { total: members.length, memberships: JSON.parse(JSON.stringify(paged)) };
    }
  }

  class MockAccount {
    async get() {
      if (!store.callerAccount) {
        throw new Error('User session not found or expired');
      }
      return JSON.parse(JSON.stringify(store.callerAccount));
    }
  }

  const MockQuery = {
    equal: (attr, val) => ({ method: 'equal', attribute: attr, value: val }),
    limit: (val) => ({ method: 'limit', value: val }),
    offset: (val) => ({ method: 'offset', value: val }),
  };

  let idCounter = 1;
  const MockID = {
    unique: () => `mock_id_${idCounter++}`,
  };

  const MockPermission = {
    read: (role) => `read("${role}")`,
    update: (role) => `update("${role}")`,
    delete: (role) => `delete("${role}")`,
  };

  const MockRole = {
    user: (id) => `user:${id}`,
    team: (id) => `team:${id}`,
  };

  class MockClient {
    setEndpoint() { return this; }
    setProject() { return this; }
    setKey() { return this; }
    setJWT() { return this; }
  }

  return {
    store,
    Client: MockClient,
    Databases: MockDatabases,
    Storage: MockStorage,
    Teams: MockTeams,
    Account: MockAccount,
    Query: MockQuery,
    ID: MockID,
    Permission: MockPermission,
    Role: MockRole,
  };
}

function createMockExecutionContext(options = {}) {
  let responseData = null;
  let responseStatus = 200;
  const logs = [];
  const errors = [];

  const req = {
    bodyJson: options.body || null,
    body: typeof options.body === 'string' ? options.body : (options.rawBody !== undefined ? options.rawBody : null),
    headers: {
      'x-appwrite-key': options.apiKey || TEST_ENV.APPWRITE_API_KEY,
      'x-appwrite-user-jwt': options.jwt !== undefined ? options.jwt : 'valid_user_jwt_token',
      ...options.headers,
    },
    path: options.path || '/',
  };

  const res = {
    json(data, status = 200) {
      responseData = data;
      responseStatus = status;
      return { status, data };
    },
    empty() {
      responseStatus = 204;
      return { status: 204 };
    },
  };

  const log = (msg) => logs.push(msg);
  const error = (msg) => errors.push(msg);

  return {
    req,
    res,
    log,
    error,
    getResult: () => ({ status: responseStatus, data: responseData, logs, errors }),
  };
}

describe('Hardened Prescription Service - Multi-Worker & Security Suite', () => {

  it('TEST-01: Rejects test configuration pointing at production resources', async () => {
    const sdk = createMockSdkState();
    const badEnv = { ...TEST_ENV, DATABASE_ID: 'medicine_support_hub' };
    const handler = createPrescriptionHandler({ ...sdk, env: badEnv, rejectProductionResources: true });
    const ctx = createMockExecutionContext({ body: { action: 'create' } });

    await assert.rejects(
      async () => handler(ctx),
      /SECURITY GUARD: Execution rejected - targeting production resource 'medicine_support_hub'/
    );
  });

  it('TEST-02: Rejects requests with missing session JWT (HTTP 401)', async () => {
    const sdk = createMockSdkState();
    const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
    const ctx = createMockExecutionContext({ jwt: null, body: { action: 'create' } });

    await handler(ctx);
    const res = ctx.getResult();
    assert.equal(res.status, 401);
    assert.equal(res.data.ok, false);
    assert.match(res.data.error, /Missing session JWT/);
  });

  it('TEST-03: Rejects requests with invalid or expired JWT (HTTP 401)', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = null;
    const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
    const ctx = createMockExecutionContext({ body: { action: 'create' } });

    await handler(ctx);
    const res = ctx.getResult();
    assert.equal(res.status, 401);
    assert.equal(res.data.ok, false);
    assert.match(res.data.error, /Invalid or expired session/);
  });

  it('TEST-04: Rejects malformed JSON body with controlled HTTP 400', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'user_1' };
    const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
    const ctx = createMockExecutionContext({ rawBody: '{ invalid_json: ', body: null });

    await handler(ctx);
    const res = ctx.getResult();
    assert.equal(res.status, 400);
    assert.equal(res.data.ok, false);
    assert.match(res.data.error, /Malformed request/);
  });

  it('TEST-05: Rejects creation upfront when any medicine item has empty drug_name (HTTP 400)', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'user_1' };
    const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
    const ctx = createMockExecutionContext({
      body: {
        action: 'create',
        items: [
          { drug_name: 'Amoxicillin 500mg' },
          { drug_name: '   ' },
        ],
      },
    });

    await handler(ctx);
    const res = ctx.getResult();
    assert.equal(res.status, 400);
    assert.equal(res.data.ok, false);
    assert.match(res.data.error, /missing required 'drug_name'/);
  });

  it('TEST-06: Creation rollback captures deletion errors and reports cleanup failure (HTTP 500)', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'user_1' };

    let createdCount = 0;
    const origCreate = sdk.Databases.prototype.createDocument;
    sdk.Databases.prototype.createDocument = async function (dbId, colId, docId, data, perms) {
      if (colId === TEST_ENV.ITEMS_COLLECTION_ID) {
        createdCount++;
        if (createdCount === 2) {
          throw new Error('Disk quota exceeded during item 2 creation');
        }
      }
      return origCreate.call(this, dbId, colId, docId, data, perms);
    };

    sdk.Databases.prototype.deleteDocument = async function () {
      throw new Error('Database cluster partition during cleanup deletion');
    };

    const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
    const ctx = createMockExecutionContext({
      body: {
        action: 'create',
        items: [
          { drug_name: 'Item 1' },
          { drug_name: 'Item 2' },
        ],
      },
    });

    await handler(ctx);
    const res = ctx.getResult();
    assert.equal(res.status, 500);
    assert.equal(res.data.ok, false);
    assert.ok(Array.isArray(res.data.deletionErrors), 'Response must contain structured deletionErrors');
    assert.ok(res.data.deletionErrors.length > 0);
  });

  it('TEST-07: Forged preferences privilege escalation rejected with actual management team ID (HTTP 403)', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = {
      $id: 'attacker_user',
      prefs: { teams: [TEST_ENV.MANAGEMENT_TEAM_ID, 'admin', 'owner'] },
    };

    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_dest`, {
      $id: 'pharm_dest', is_active: true, team_id: 'team_dest',
    });
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:rx_victim`, {
      $id: 'rx_victim', user_id: 'victim_user', status: 'pending_review',
    });

    const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
    const ctx = createMockExecutionContext({
      body: { action: 'route', prescription_id: 'rx_victim', pharmacy_id: 'pharm_dest' },
    });

    await handler(ctx);
    const res = ctx.getResult();
    assert.equal(res.status, 403);
    assert.equal(res.data.ok, false);
    assert.match(res.data.error, /Forbidden/);
  });

  it('TEST-08: Paginated membership lookup verifies user on page 2 with Administrator role', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'admin_bob' };

    const page1Members = Array.from({ length: 50 }, (_, i) => ({
      userId: `other_user_${i}`, confirm: true, roles: ['member'],
    }));
    const page2Members = [
      { userId: 'admin_bob', confirm: true, roles: ['Administrator'] },
    ];
    sdk.store.memberships.set(TEST_ENV.MANAGEMENT_TEAM_ID, [...page1Members, ...page2Members]);

    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_dest`, {
      $id: 'pharm_dest', is_active: true, team_id: 'team_dest',
    });
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:rx_p2`, {
      $id: 'rx_p2', user_id: 'other_patient', status: 'pending_review',
    });

    const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
    const ctx = createMockExecutionContext({
      body: { action: 'route', prescription_id: 'rx_p2', pharmacy_id: 'pharm_dest' },
    });

    await handler(ctx);
    const res = ctx.getResult();
    assert.equal(res.status, 200, 'Administrator on page 2 must be recognized as management');
    assert.equal(res.data.ok, true);
  });

  it('TEST-09: Confirmed membership with unauthorized role rejected (HTTP 403)', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'guest_user' };
    sdk.store.memberships.set(TEST_ENV.MANAGEMENT_TEAM_ID, [
      { userId: 'guest_user', confirm: true, roles: ['guest_viewer'] },
    ]);

    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_dest`, {
      $id: 'pharm_dest', is_active: true, team_id: 'team_dest',
    });
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:rx_auth_test`, {
      $id: 'rx_auth_test', user_id: 'real_patient', status: 'pending_review',
    });

    const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
    const ctx = createMockExecutionContext({
      body: { action: 'route', prescription_id: 'rx_auth_test', pharmacy_id: 'pharm_dest' },
    });

    await handler(ctx);
    const res = ctx.getResult();
    assert.equal(res.status, 403);
    assert.equal(res.data.ok, false);
  });

  it('TEST-10: File ownership strictly requires delete permission; shared read/update rejected (HTTP 403)', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'user_1' };

    const fileId = 'file_shared_only';
    const uploadKey = `${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:upload_${fileId}`;
    sdk.store.documents.set(uploadKey, {
      $id: `upload_${fileId}`,
      user_id: 'user_1',
      status: 'registered',
      image_id: fileId,
      ai_parsed_json: JSON.stringify({ upload_token: 'tok_test_10', uploader_id: 'user_1' }),
    });

    const fileKey = `${TEST_ENV.STORAGE_BUCKET_ID}:${fileId}`;
    sdk.store.files.set(fileKey, {
      $id: fileId,
      $permissions: ['read("user:user_1")', 'update("user:user_1")'],
    });

    const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
    const ctx = createMockExecutionContext({
      body: {
        action: 'create',
        image_id: fileId,
        upload_token: 'tok_test_10',
        items: [{ drug_name: 'Aspirin' }],
      },
    });

    await handler(ctx);
    const res = ctx.getResult();
    assert.equal(res.status, 403);
    assert.equal(res.data.ok, false);
    assert.match(res.data.error, /delete permission required/);
  });

  it('TEST-11: Reassign authorizes caller before status check (prevents status disclosure, HTTP 403)', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'unrelated_user' };

    const rxKey = `${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:rx_dispensed`;
    sdk.store.documents.set(rxKey, {
      $id: 'rx_dispensed',
      user_id: 'patient_owner',
      status: 'dispensed',
      pharmacy_id: 'pharm_orig',
    });

    const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
    const ctx = createMockExecutionContext({
      body: { action: 'reassign', prescription_id: 'rx_dispensed', new_pharmacy_id: 'pharm_new' },
    });

    await handler(ctx);
    const res = ctx.getResult();
    assert.equal(res.status, 403, 'Must return 403 Forbidden without leaking that prescription is dispensed');
    assert.equal(res.data.ok, false);
    assert.match(res.data.error, /Forbidden/);
  });

  it('TEST-12: Authorized caller cannot reassign prescription in terminal status (HTTP 400)', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'patient_owner' };

    const rxKey = `${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:rx_terminal`;
    sdk.store.documents.set(rxKey, {
      $id: 'rx_terminal',
      user_id: 'patient_owner',
      status: 'dispensed',
      pharmacy_id: 'pharm_orig',
    });

    const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
    const ctx = createMockExecutionContext({
      body: { action: 'reassign', prescription_id: 'rx_terminal', new_pharmacy_id: 'pharm_new' },
    });

    await handler(ctx);
    const res = ctx.getResult();
    assert.equal(res.status, 400);
    assert.equal(res.data.ok, false);
    assert.match(res.data.error, /Invalid transition/);
  });

  it('TEST-13: Rejects missing, inactive (is_active: false/missing), or unmapped pharmacy (HTTP 400/500)', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'patient_owner' };

    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_inactive`, {
      $id: 'pharm_inactive', is_active: false, team_id: 'team_inactive',
    });
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_no_team`, {
      $id: 'pharm_no_team', is_active: true, team_id: '',
    });

    const rxKey = `${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:rx_test_pharm`;
    sdk.store.documents.set(rxKey, {
      $id: 'rx_test_pharm', user_id: 'patient_owner', status: 'pending_review',
    });

    const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });

    const ctx1 = createMockExecutionContext({
      body: { action: 'route', prescription_id: 'rx_test_pharm', pharmacy_id: 'pharm_inactive' },
    });
    await handler(ctx1);
    assert.equal(ctx1.getResult().status, 500);

    const ctx2 = createMockExecutionContext({
      body: { action: 'route', prescription_id: 'rx_test_pharm', pharmacy_id: 'pharm_no_team' },
    });
    await handler(ctx2);
    assert.equal(ctx2.getResult().status, 500);
  });

  it('TEST-14: Failed parent restore does not skip child restore and returns structured rollback errors (HTTP 500)', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'patient_alice' };

    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_b`, {
      $id: 'pharm_b', is_active: true, team_id: 'team_pharm_b',
    });

    const rxId = 'rx_fail_parent_restore';
    const rxKey = `${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${rxId}`;
    sdk.store.documents.set(rxKey, {
      $id: rxId, user_id: 'patient_alice', status: 'routed', pharmacy_id: 'pharm_a',
      $permissions: ['read("user:patient_alice")', 'read("team:team_pharm_a")'],
    });

    const item1Key = `${TEST_ENV.DATABASE_ID}:${TEST_ENV.ITEMS_COLLECTION_ID}:item_1`;
    sdk.store.documents.set(item1Key, {
      $id: 'item_1', prescription_id: rxId, drug_name: 'Drug 1',
      $permissions: ['read("user:patient_alice")', 'read("team:team_pharm_a")'],
    });
    const item2Key = `${TEST_ENV.DATABASE_ID}:${TEST_ENV.ITEMS_COLLECTION_ID}:item_2`;
    sdk.store.documents.set(item2Key, {
      $id: 'item_2', prescription_id: rxId, drug_name: 'Drug 2',
      $permissions: ['read("user:patient_alice")', 'read("team:team_pharm_a")'],
    });

    let updateCount = 0;
    const origUpdate = sdk.Databases.prototype.updateDocument;
    sdk.Databases.prototype.updateDocument = async function (dbId, colId, docId, data, perms) {
      updateCount++;
      if (colId === TEST_ENV.ITEMS_COLLECTION_ID && docId === 'item_2') {
        throw new Error('Simulated failure during child item 2 update');
      }
      if (updateCount > 2 && colId === TEST_ENV.PRESCRIPTIONS_COLLECTION_ID && docId === rxId) {
        throw new Error('Simulated parent restoration failure');
      }
      return origUpdate.call(this, dbId, colId, docId, data, perms);
    };

    const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
    const ctx = createMockExecutionContext({
      body: { action: 'reassign', prescription_id: rxId, new_pharmacy_id: 'pharm_b' },
    });

    await handler(ctx);
    const res = ctx.getResult();
    assert.equal(res.status, 500);
    assert.equal(res.data.ok, false);
    assert.ok(res.data.rollbackErrors, 'Response must detail rollbackErrors');
    assert.match(res.data.rollbackErrors.parent, /Parent rollback failed/);

    const item1 = sdk.store.documents.get(item1Key);
    assert.ok(item1.$permissions.includes('read("team:team_pharm_a")'), 'Child item 1 must be restored even if parent restore failed');
    assert.ok(!item1.$permissions.includes('read("team:team_pharm_b")'));
  });

  // Test 15: Database-Enforced Mutex Concurrency across separate worker instances
  it('TEST-15: Database mutex blocks concurrent worker with HTTP 409 and guarantees consistent child permissions', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'patient_alice' };

    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_worker1`, {
      $id: 'pharm_worker1', is_active: true, team_id: 'team_pharm_1',
    });
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_worker2`, {
      $id: 'pharm_worker2', is_active: true, team_id: 'team_pharm_2',
    });

    const rxId = 'rx_db_mutex_race';
    const rxKey = `${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${rxId}`;
    sdk.store.documents.set(rxKey, {
      $id: rxId,
      user_id: 'patient_alice',
      status: 'routed',
      pharmacy_id: 'pharm_orig',
      $permissions: ['read("user:patient_alice")', 'read("team:team_pharm_orig")'],
    });

    const item1Key = `${TEST_ENV.DATABASE_ID}:${TEST_ENV.ITEMS_COLLECTION_ID}:item_db_1`;
    sdk.store.documents.set(item1Key, {
      $id: 'item_db_1', prescription_id: rxId, drug_name: 'Med 1',
      $permissions: ['read("user:patient_alice")', 'read("team:team_pharm_orig")'],
    });
    const item2Key = `${TEST_ENV.DATABASE_ID}:${TEST_ENV.ITEMS_COLLECTION_ID}:item_db_2`;
    sdk.store.documents.set(item2Key, {
      $id: 'item_db_2', prescription_id: rxId, drug_name: 'Med 2',
      $permissions: ['read("user:patient_alice")', 'read("team:team_pharm_orig")'],
    });

    // Create two independent handler instances
    const workerInstance1 = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
    const workerInstance2 = createPrescriptionHandler({ ...sdk, env: TEST_ENV });

    // While Worker 1 is in progress cascading items, Worker 2 attempts concurrent reassignment
    let intercepted = false;
    let worker2Result = null;
    const origListDocs = sdk.Databases.prototype.listDocuments;
    sdk.Databases.prototype.listDocuments = async function (dbId, colId, queries) {
      if (colId === TEST_ENV.ITEMS_COLLECTION_ID && !intercepted) {
        intercepted = true;
        const ctx2 = createMockExecutionContext({
          body: { action: 'reassign', prescription_id: rxId, new_pharmacy_id: 'pharm_worker2' },
        });
        await workerInstance2(ctx2);
        worker2Result = ctx2.getResult();
      }
      return origListDocs.call(this, dbId, colId, queries);
    };

    const ctx1 = createMockExecutionContext({
      body: { action: 'reassign', prescription_id: rxId, new_pharmacy_id: 'pharm_worker1' },
    });

    await workerInstance1(ctx1);
    const res1 = ctx1.getResult();

    // Worker 1 succeeds completely
    assert.equal(res1.status, 200, 'Worker 1 must succeed');
    assert.equal(res1.data.ok, true);

    // Worker 2 was rejected by the database-enforced mutex lock with HTTP 409 Conflict
    assert.ok(worker2Result !== null, 'Worker 2 must have run during Worker 1 execution');
    assert.equal(worker2Result.status, 409, 'Worker 2 must be rejected with HTTP 409 Conflict');
    assert.match(worker2Result.data.error, /Conflict: A concurrent reassignment operation is already in progress/);

    // Verify parent assignment belongs ONLY to winning Worker 1
    const finalParent = sdk.store.documents.get(rxKey);
    assert.equal(finalParent.pharmacy_id, 'pharm_worker1');
    assert.ok(finalParent.$permissions.includes('read("team:team_pharm_1")'));
    assert.ok(!finalParent.$permissions.includes('read("team:team_pharm_2")'));

    // CRITICAL: Verify EVERY child item has winning Worker 1 permissions and ZERO Worker 2 permissions
    const finalChild1 = sdk.store.documents.get(item1Key);
    assert.ok(finalChild1.$permissions.includes('read("team:team_pharm_1")'), 'Child 1 must have winning team');
    assert.ok(!finalChild1.$permissions.includes('read("team:team_pharm_2")'), 'Child 1 must NOT have losing team');

    const finalChild2 = sdk.store.documents.get(item2Key);
    assert.ok(finalChild2.$permissions.includes('read("team:team_pharm_1")'), 'Child 2 must have winning team');
    assert.ok(!finalChild2.$permissions.includes('read("team:team_pharm_2")'), 'Child 2 must NOT have losing team');

    // Verify database mutex lock document was cleanly released upon completion
    const lockKey = `${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:lock_${rxId}`;
    assert.equal(sdk.store.documents.has(lockKey), false, 'Database lock must be released after completion');
  });

  // Test 16: Complete successful reassignment revokes old pharmacy and grants new pharmacy across all items
  it('TEST-16: Successful reassignment revokes old pharmacy and grants new pharmacy across parent and child items', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'patient_alice' };

    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_old`, {
      $id: 'pharm_old', is_active: true, team_id: 'team_pharm_old',
    });
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_new`, {
      $id: 'pharm_new', is_active: true, team_id: 'team_pharm_new',
    });

    const rxId = 'rx_success_reassign';
    const rxKey = `${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${rxId}`;
    sdk.store.documents.set(rxKey, {
      $id: rxId,
      user_id: 'patient_alice',
      status: 'routed',
      pharmacy_id: 'pharm_old',
      $permissions: ['read("user:patient_alice")', `read("team:${TEST_ENV.MANAGEMENT_TEAM_ID}")`, 'read("team:team_pharm_old")'],
    });

    const item1Key = `${TEST_ENV.DATABASE_ID}:${TEST_ENV.ITEMS_COLLECTION_ID}:child_1`;
    sdk.store.documents.set(item1Key, {
      $id: 'child_1', prescription_id: rxId, drug_name: 'Metformin 500mg',
      $permissions: ['read("user:patient_alice")', `read("team:${TEST_ENV.MANAGEMENT_TEAM_ID}")`, 'read("team:team_pharm_old")'],
    });
    const item2Key = `${TEST_ENV.DATABASE_ID}:${TEST_ENV.ITEMS_COLLECTION_ID}:child_2`;
    sdk.store.documents.set(item2Key, {
      $id: 'child_2', prescription_id: rxId, drug_name: 'Lisinopril 10mg',
      $permissions: ['read("user:patient_alice")', `read("team:${TEST_ENV.MANAGEMENT_TEAM_ID}")`, 'read("team:team_pharm_old")'],
    });

    const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
    const ctx = createMockExecutionContext({
      body: { action: 'reassign', prescription_id: rxId, new_pharmacy_id: 'pharm_new' },
    });

    await handler(ctx);
    const res = ctx.getResult();
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true);
    assert.equal(res.data.itemsUpdated, 2);

    const updatedParent = sdk.store.documents.get(rxKey);
    assert.equal(updatedParent.pharmacy_id, 'pharm_new');
    assert.equal(updatedParent.status, 'reassigned');
    assert.ok(updatedParent.$permissions.includes('read("team:team_pharm_new")'));
    assert.ok(!updatedParent.$permissions.includes('read("team:team_pharm_old")'));

    const updatedChild1 = sdk.store.documents.get(item1Key);
    assert.ok(updatedChild1.$permissions.includes('read("team:team_pharm_new")'));
    assert.ok(!updatedChild1.$permissions.includes('read("team:team_pharm_old")'));

    const updatedChild2 = sdk.store.documents.get(item2Key);
    assert.ok(updatedChild2.$permissions.includes('read("team:team_pharm_new")'));
    assert.ok(!updatedChild2.$permissions.includes('read("team:team_pharm_old")'));
  });

  // Test 17: Competing write blocked between rollback check and restoration
  it('TEST-17: Database-enforced mutex blocks competing writes attempted between rollback check and restoration', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'patient_alice' };

    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_fail`, {
      $id: 'pharm_fail', is_active: true, team_id: 'team_pharm_fail',
    });
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_competitor`, {
      $id: 'pharm_competitor', is_active: true, team_id: 'team_pharm_comp',
    });

    const rxId = 'rx_compete_during_rollback';
    const rxKey = `${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${rxId}`;
    sdk.store.documents.set(rxKey, {
      $id: rxId, user_id: 'patient_alice', status: 'routed', pharmacy_id: 'pharm_orig',
      $permissions: ['read("user:patient_alice")', 'read("team:team_pharm_orig")'],
    });

    const itemKey = `${TEST_ENV.DATABASE_ID}:${TEST_ENV.ITEMS_COLLECTION_ID}:item_comp`;
    sdk.store.documents.set(itemKey, {
      $id: 'item_comp', prescription_id: rxId, drug_name: 'CompMed',
      $permissions: ['read("user:patient_alice")', 'read("team:team_pharm_orig")'],
    });

    const worker1 = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
    const worker2 = createPrescriptionHandler({ ...sdk, env: TEST_ENV });

    // Inject failure on child item update in Worker 1 to trigger rollback
    const origUpdate = sdk.Databases.prototype.updateDocument;
    let competitorRan = false;
    let competitorAttemptResult = null;
    sdk.Databases.prototype.updateDocument = async function (dbId, colId, docId, data, perms) {
      if (colId === TEST_ENV.ITEMS_COLLECTION_ID && docId === 'item_comp' && !competitorRan) {
        competitorRan = true;
        // While Worker 1 is failing and about to roll back, Worker 2 attempts reassignment
        const ctx2 = createMockExecutionContext({
          body: { action: 'reassign', prescription_id: rxId, new_pharmacy_id: 'pharm_competitor' },
        });
        await worker2(ctx2);
        competitorAttemptResult = ctx2.getResult();
        throw new Error('Trigger rollback on item update');
      }
      return origUpdate.call(this, dbId, colId, docId, data, perms);
    };

    const ctx1 = createMockExecutionContext({
      body: { action: 'reassign', prescription_id: rxId, new_pharmacy_id: 'pharm_fail' },
    });

    await worker1(ctx1);

    // Competitor Worker 2 was rejected by the database mutex
    assert.ok(competitorAttemptResult !== null, 'Worker 2 must have attempted reassignment');
    assert.equal(competitorAttemptResult.status, 409, 'Worker 2 must be rejected with 409 Conflict');
    assert.match(competitorAttemptResult.data.error, /Conflict: A concurrent reassignment operation is already in progress/);

    // After rollback finishes, parent and child are restored and transition document is recorded as aborted
    const finalParent = sdk.store.documents.get(rxKey);
    assert.equal(finalParent.pharmacy_id, 'pharm_orig');
    assert.equal(finalParent.status, 'routed');

    const txKey = `${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:tx_${rxId}_v2`;
    const txDoc = sdk.store.documents.get(txKey);
    assert.ok(txDoc, 'Transition document must exist');
    assert.equal(txDoc.status, 'transition_aborted', 'Failed transition must be recorded as aborted');
  });

  // Test 18: Guaranteed access quarantine strips target pharmacy grant when child restoration encounters failure
  it('TEST-18: Guaranteed rollback access quarantine strips target pharmacy grant when child restoration fails', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'patient_alice' };

    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_target`, {
      $id: 'pharm_target', is_active: true, team_id: 'team_pharm_target',
    });

    const rxId = 'rx_quarantine_test';
    const rxKey = `${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${rxId}`;
    sdk.store.documents.set(rxKey, {
      $id: rxId, user_id: 'patient_alice', status: 'routed', pharmacy_id: 'pharm_orig',
      $permissions: ['read("user:patient_alice")'],
    });

    const item1Key = `${TEST_ENV.DATABASE_ID}:${TEST_ENV.ITEMS_COLLECTION_ID}:item_q1`;
    sdk.store.documents.set(item1Key, {
      $id: 'item_q1', prescription_id: rxId, drug_name: 'Med Q1',
      $permissions: ['read("user:patient_alice")'],
    });
    const item2Key = `${TEST_ENV.DATABASE_ID}:${TEST_ENV.ITEMS_COLLECTION_ID}:item_q2`;
    sdk.store.documents.set(item2Key, {
      $id: 'item_q2', prescription_id: rxId, drug_name: 'Med Q2',
      $permissions: ['read("user:patient_alice")'],
    });

    // Make item 2 fail on initial update, and item 1 fail on restoration but succeed on quarantine
    const origUpdate = sdk.Databases.prototype.updateDocument;
    let item1RestoreCount = 0;
    let cascadeFailed = false;
    sdk.Databases.prototype.updateDocument = async function (dbId, colId, docId, data, perms) {
      // Item 2 fails during cascade
      if (colId === TEST_ENV.ITEMS_COLLECTION_ID && docId === 'item_q2' && !cascadeFailed) {
        cascadeFailed = true;
        throw new Error('Cascade failure on item 2');
      }
      // When restoring item 1 during rollback (after cascade failed), simulate restore failure on attempts 0 and 1, then let quarantine succeed
      if (cascadeFailed && colId === TEST_ENV.ITEMS_COLLECTION_ID && docId === 'item_q1' && item1RestoreCount < 2) {
        item1RestoreCount++;
        throw new Error('Simulated restore failure on item 1');
      }
      return origUpdate.call(this, dbId, colId, docId, data, perms);
    };

    const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
    const ctx = createMockExecutionContext({
      body: { action: 'reassign', prescription_id: rxId, new_pharmacy_id: 'pharm_target' },
    });

    await handler(ctx);
    const res = ctx.getResult();
    assert.equal(res.status, 500);
    assert.equal(res.data.ok, false);
    assert.equal(res.data.quarantineEnforced, true, 'Quarantine must be enforced');
    assert.equal(res.data.quarantineFailed, false, 'Quarantine must not be marked failed');

    // Access Quarantine Verification: Item 1 MUST NOT have team_pharm_target in permissions!
    const item1Final = sdk.store.documents.get(item1Key);
    assert.ok(!item1Final.$permissions.includes('read("team:team_pharm_target")'), 'Quarantine must have stripped target pharmacy team grant');
  });

  // Test 18B: Quarantine write failure is explicitly reported (quarantineEnforced: false, quarantineFailed: true)
  it('TEST-18B: Quarantine write failure is explicitly reported (quarantineEnforced: false, quarantineFailed: true)', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'patient_alice' };

    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_target`, {
      $id: 'pharm_target', is_active: true, team_id: 'team_pharm_target',
    });

    const rxId = 'rx_quarantine_fail_test';
    const rxKey = `${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${rxId}`;
    sdk.store.documents.set(rxKey, {
      $id: rxId, user_id: 'patient_alice', status: 'routed', pharmacy_id: 'pharm_orig',
      $permissions: ['read("user:patient_alice")'],
    });

    const itemKey = `${TEST_ENV.DATABASE_ID}:${TEST_ENV.ITEMS_COLLECTION_ID}:item_q_fail`;
    sdk.store.documents.set(itemKey, {
      $id: 'item_q_fail', prescription_id: rxId, drug_name: 'Med Fail',
      $permissions: ['read("user:patient_alice")'],
    });

    const origUpdate = sdk.Databases.prototype.updateDocument;
    let updateCount = 0;
    sdk.Databases.prototype.updateDocument = async function (dbId, colId, docId, data, perms) {
      updateCount++;
      // Initial cascade update fails
      if (colId === TEST_ENV.ITEMS_COLLECTION_ID && docId === 'item_q_fail' && updateCount === 1) {
        throw new Error('Simulated cascade error');
      }
      // Rollback restore and quarantine writes all fail
      if (colId === TEST_ENV.ITEMS_COLLECTION_ID && docId === 'item_q_fail' && updateCount > 1) {
        throw new Error('Network error during quarantine write');
      }
      return origUpdate.call(this, dbId, colId, docId, data, perms);
    };

    const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
    const ctx = createMockExecutionContext({
      body: { action: 'reassign', prescription_id: rxId, new_pharmacy_id: 'pharm_target' },
    });

    await handler(ctx);
    const res = ctx.getResult();
    assert.equal(res.status, 500);
    assert.equal(res.data.ok, false);
    assert.equal(res.data.quarantineEnforced, false, 'Quarantine must NOT be reported as enforced when write fails');
    assert.equal(res.data.quarantineFailed, true, 'Quarantine must be reported as failed');
    assert.ok(Array.isArray(res.data.quarantineVerificationFailures), 'Verification failures array must be returned');
    assert.ok(res.data.quarantineVerificationFailures.length > 0);
  });

  // Test 19: Atomic image-claim mechanism: Simultaneous submissions for same image atomically rejected with HTTP 409
  it('TEST-19: Atomic image claim: Simultaneous submissions for same image atomically rejected with HTTP 409', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'patient_alice' };

    const fileId = 'img_atomic_claim_123';
    const uploadToken = 'tok_claim_19';
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:upload_${fileId}`, {
      $id: `upload_${fileId}`,
      user_id: 'patient_alice',
      status: 'registered',
      image_id: fileId,
      ai_parsed_json: JSON.stringify({ upload_token: uploadToken, uploader_id: 'patient_alice' }),
    });
    sdk.store.files.set(`${TEST_ENV.STORAGE_BUCKET_ID}:${fileId}`, {
      $id: fileId,
      $permissions: ['read("user:patient_alice")', 'delete("user:patient_alice")'],
    });

    const worker1 = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
    const worker2 = createPrescriptionHandler({ ...sdk, env: TEST_ENV });

    // Both workers attempt creation with the exact same image_id and valid upload_token
    const ctx1 = createMockExecutionContext({
      body: { action: 'create', image_id: fileId, upload_token: uploadToken, items: [{ drug_name: 'Paracetamol' }] },
    });
    const ctx2 = createMockExecutionContext({
      body: { action: 'create', image_id: fileId, upload_token: uploadToken, items: [{ drug_name: 'Paracetamol' }] },
    });

    await Promise.all([worker1(ctx1), worker2(ctx2)]);

    const res1 = ctx1.getResult();
    const res2 = ctx2.getResult();

    // Exactly ONE must succeed (201) and ONE must fail with 409 Conflict
    const statuses = [res1.status, res2.status].sort();
    assert.deepEqual(statuses, [201, 409], 'Exactly one submission succeeds with 201 and duplicate is rejected with 409');

    const conflictRes = res1.status === 409 ? res1 : res2;
    assert.match(conflictRes.data.error, /Conflict: Referenced image has already been claimed/);
  });

  // Test 20: Image claim ownership: User cannot claim an image registered to or claimed by another user (HTTP 403)
  it('TEST-20: Image claim ownership: User cannot claim an image claimed by another user (HTTP 403)', async () => {
    const sdk = createMockSdkState();

    const fileId = 'img_alice_private';
    const uploadToken = 'tok_alice_20';
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:upload_${fileId}`, {
      $id: `upload_${fileId}`,
      user_id: 'patient_alice',
      status: 'registered',
      image_id: fileId,
      ai_parsed_json: JSON.stringify({ upload_token: uploadToken, uploader_id: 'patient_alice' }),
    });
    sdk.store.files.set(`${TEST_ENV.STORAGE_BUCKET_ID}:${fileId}`, {
      $id: fileId,
      $permissions: ['read("user:patient_bob")', 'delete("user:patient_bob")'],
    });

    sdk.store.callerAccount = { $id: 'patient_bob' };

    const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
    const ctx = createMockExecutionContext({
      body: { action: 'create', image_id: fileId, upload_token: uploadToken, items: [{ drug_name: 'Amoxicillin' }] },
    });

    await handler(ctx);
    const res = ctx.getResult();
    assert.equal(res.status, 403, 'Must return 403 Forbidden when attempting to claim image owned by another user');
    assert.match(res.data.error, /Forbidden: Referenced image is registered or claimed by another user/);
  });

  // Test 21: Trusted upload provenance: Pre-registered upload intent verified and transitioned to claimed
  it('TEST-21: Trusted upload provenance: Pre-registered upload intent verified and transitioned to claimed upon create', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'patient_alice' };

    const fileId = 'img_pre_registered_intent';
    sdk.store.files.set(`${TEST_ENV.STORAGE_BUCKET_ID}:${fileId}`, {
      $id: fileId,
      $permissions: ['read("user:patient_alice")', 'delete("user:patient_alice")'],
    });

    const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });

    // Step 1: Pre-register upload intent
    const regCtx = createMockExecutionContext({
      body: { action: 'register_upload', file_id: fileId },
    });
    await handler(regCtx);
    const regRes = regCtx.getResult();
    assert.equal(regRes.status, 201);
    assert.equal(regRes.data.claim.status, 'registered');
    const uploadToken = regRes.data.upload_token;
    assert.ok(uploadToken, 'Upload token must be generated');

    // Step 2: Patient 1 creates prescription with this pre-registered image and valid token
    const createCtx = createMockExecutionContext({
      body: { action: 'create', image_id: fileId, upload_token: uploadToken, items: [{ drug_name: 'Metformin' }] },
    });
    await handler(createCtx);
    const createRes = createCtx.getResult();
    assert.equal(createRes.status, 201);
    assert.equal(createRes.data.ok, true);

    // Step 3: Claim in database is now transitioned to 'claimed'
    const claimDoc = sdk.store.documents.get(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:claim_${fileId}`);
    assert.equal(claimDoc.status, 'claimed');

    // Step 4: Subsequent creation attempt by another user is blocked with 403
    sdk.store.callerAccount = { $id: 'patient_mallory' };
    const malCtx = createMockExecutionContext({
      body: { action: 'create', image_id: fileId, upload_token: uploadToken, items: [{ drug_name: 'Metformin' }] },
    });
    await handler(malCtx);
    assert.equal(malCtx.getResult().status, 403);
  });

  // Test 22: Versioned transition engine: Transition document uniqueness atomically blocks concurrent transition attempts
  it('TEST-22: Versioned transition engine: Transition document uniqueness atomically blocks concurrent transition attempts for same version', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'worker_alpha' };

    const rxId = 'rx_fencing_test';
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${rxId}`, {
      $id: rxId, user_id: 'worker_alpha', status: 'pending_review',
      ai_parsed_json: JSON.stringify({ version: 1 }),
      $permissions: ['read("user:worker_alpha")'],
    });
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_dest`, {
      $id: 'pharm_dest', is_active: true, team_id: 'team_pharm_dest',
    });

    // Simulate transition v2 already claimed by another worker
    const txKey = `${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:tx_${rxId}_v2`;
    sdk.store.documents.set(txKey, {
      $id: `tx_${rxId}_v2`,
      user_id: 'worker_beta',
      status: 'transition_pending',
      ai_parsed_json: JSON.stringify({
        prescription_id: rxId,
        from_version: 1,
        to_version: 2,
        action: 'route',
      }),
    });

    const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
    const ctx = createMockExecutionContext({
      body: { action: 'route', prescription_id: rxId, pharmacy_id: 'pharm_dest' },
    });
    await handler(ctx);
    const res = ctx.getResult();
    assert.equal(res.status, 409);
    assert.match(res.data.error, /transition_pending|transition version 2 already claimed/);

    // Verify existing transition document was NOT overwritten or disturbed
    const currentTx = sdk.store.documents.get(txKey);
    assert.ok(currentTx, 'Existing transition document must remain intact');
    assert.equal(currentTx.user_id, 'worker_beta');
  });

  // Test 23: Versioned transition engine: Active pending transition blocks subsequent operations with HTTP 409
  it('TEST-23: Versioned transition engine: Active pending transition blocks subsequent operations with HTTP 409', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'worker_new' };

    const rxId = 'rx_active_tx_test';
    const txId = `tx_${rxId}_v2`;
    // Parent prescription has active_tx pointing to pending transition
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${rxId}`, {
      $id: rxId, user_id: 'worker_new', status: 'routed', pharmacy_id: 'pharm_dest',
      ai_parsed_json: JSON.stringify({ version: 2, active_tx: txId }),
      $permissions: ['read("user:worker_new")'],
    });
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_dest2`, {
      $id: 'pharm_dest2', is_active: true, team_id: 'team_pharm_dest2',
    });

    // The pending transition document exists with status transition_pending
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${txId}`, {
      $id: txId,
      user_id: 'worker_prev',
      status: 'transition_pending',
      ai_parsed_json: JSON.stringify({ prescription_id: rxId, to_version: 2 }),
    });

    const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
    const ctx = createMockExecutionContext({
      body: { action: 'reassign', prescription_id: rxId, new_pharmacy_id: 'pharm_dest2' },
    });
    await handler(ctx);
    const res = ctx.getResult();
    assert.equal(res.status, 409, 'Must return 409 Conflict when previous transition is still pending');
    assert.match(res.data.error, /A concurrent reassignment operation is already in progress/);
  });

  // Test 24: register_upload verifies storage file delete permission and rejects non-owners
  it('TEST-24: register_upload verifies storage file delete permission and rejects non-owners', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'patient_alice' };

    const fileId = 'img_unauthorized_upload';
    // File exists in storage, but belongs to patient_bob (no delete permission for alice)
    sdk.store.files.set(`${TEST_ENV.STORAGE_BUCKET_ID}:${fileId}`, {
      $id: fileId,
      $permissions: ['read("user:patient_bob")', 'delete("user:patient_bob")'],
    });

    const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
    const ctx = createMockExecutionContext({
      body: { action: 'register_upload', file_id: fileId },
    });
    await handler(ctx);
    const res = ctx.getResult();
    assert.equal(res.status, 403, 'Must reject registration if caller is not the verified uploader');
    assert.match(res.data.error, /delete permission required/);

    // And test with non-existent file
    const ctx404 = createMockExecutionContext({
      body: { action: 'register_upload', file_id: 'non_existent_file' },
    });
    await handler(ctx404);
    assert.equal(ctx404.getResult().status, 404, 'Must return 404 if file does not exist in storage');
  });

  // Test 25: Overlapping rollback and reassignment: Transition in transition_recovering blocks concurrent operations with HTTP 409
  it('TEST-25: Overlapping rollback and reassignment: Transition in transition_recovering blocks concurrent operations with HTTP 409', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'patient_alice' };

    const rxId = 'rx_overlap_test';
    const txId = `tx_${rxId}_v2`;

    // Prescription is in routed status with active_tx pointing to txId
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${rxId}`, {
      $id: rxId,
      user_id: 'patient_alice',
      status: 'routed',
      pharmacy_id: 'pharm_orig',
      ai_parsed_json: JSON.stringify({ version: 1, active_tx: txId }),
      $permissions: ['read("user:patient_alice")'],
    });

    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_orig`, {
      $id: 'pharm_orig', is_active: true, team_id: 'team_pharm_orig',
    });
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_dest`, {
      $id: 'pharm_dest', is_active: true, team_id: 'team_pharm_dest',
    });

    // An in-flight recovery is running: txId has status transition_recovering
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${txId}`, {
      $id: txId,
      user_id: 'patient_alice',
      status: 'transition_recovering',
      ai_parsed_json: JSON.stringify({ prescription_id: rxId, from_version: 1, to_version: 2 }),
    });

    const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });

    // Worker 2 attempts reassignment while recovery is running -> Must be blocked with 409 Conflict
    const ctx = createMockExecutionContext({
      body: { action: 'reassign', prescription_id: rxId, new_pharmacy_id: 'pharm_dest' },
    });
    await handler(ctx);
    const res = ctx.getResult();
    assert.equal(res.status, 409, 'Must reject with 409 Conflict while transition is in transition_recovering');
    assert.match(res.data.error, /is transition_recovering/);

    // After recovery finishes and marks transition_aborted, retry can atomically reclaim and succeed
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${txId}`, {
      $id: txId,
      user_id: 'patient_alice',
      status: 'transition_aborted',
      ai_parsed_json: JSON.stringify({ prescription_id: rxId, from_version: 1, to_version: 2 }),
    });

    // Parent has rolled back
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${rxId}`, {
      $id: rxId,
      user_id: 'patient_alice',
      status: 'routed',
      pharmacy_id: 'pharm_orig',
      ai_parsed_json: JSON.stringify({ version: 1, active_tx: txId }),
      $permissions: ['read("user:patient_alice")'],
    });

    const retryCtx = createMockExecutionContext({
      body: { action: 'reassign', prescription_id: rxId, new_pharmacy_id: 'pharm_dest' },
    });
    await handler(retryCtx);
    const retryRes = retryCtx.getResult();
    assert.equal(retryRes.status, 200, 'Must succeed after previous aborted transition is reclaimed');
    assert.equal(retryRes.data.ok, true);
  });

  // Test 26: Failed parent update recovery: transition is purged and retries do not collide
  it('TEST-26: Failed parent update recovery: transition is purged and retries do not collide', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'patient_alice' };

    const rxId = 'rx_fail_parent_test';
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${rxId}`, {
      $id: rxId,
      user_id: 'patient_alice',
      status: 'pending_review',
      ai_parsed_json: JSON.stringify({ version: 1 }),
      $permissions: ['read("user:patient_alice")'],
    });
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_dest`, {
      $id: 'pharm_dest', is_active: true, team_id: 'team_pharm_dest',
    });

    // Cause parent update to fail on first attempt
    const origUpdateDocument = sdk.Databases.prototype.updateDocument;
    let failParentUpdate = true;
    sdk.Databases.prototype.updateDocument = async function(dbId, colId, docId, data, permissions) {
      if (docId === rxId && failParentUpdate) {
        const err = new Error('Database constraint violation during parent update');
        err.code = 400;
        throw err;
      }
      return origUpdateDocument.call(this, dbId, colId, docId, data, permissions);
    };

    try {
      const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });

      // Attempt routing -> parent update fails
      const ctx1 = createMockExecutionContext({
        body: { action: 'route', prescription_id: rxId, pharmacy_id: 'pharm_dest' },
      });
      await handler(ctx1);
      const res1 = ctx1.getResult();
      assert.equal(res1.status, 500, 'Must return 500 when parent update fails');
      assert.match(res1.data.error, /Failed to update prescription state/);

      // Verify transition document was purged or aborted so the prescription is not stuck
      const txKey = `${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:tx_${rxId}_v2`;
      const txDoc = sdk.store.documents.get(txKey);
      assert.ok(!txDoc || txDoc.status === 'transition_aborted', 'Transition document must not remain pending');

      // Second attempt (retry) with working parent update succeeds without collision
      failParentUpdate = false;
      const ctx2 = createMockExecutionContext({
        body: { action: 'route', prescription_id: rxId, pharmacy_id: 'pharm_dest' },
      });
      await handler(ctx2);
      const res2 = ctx2.getResult();
      assert.equal(res2.status, 200, 'Retry must succeed without collision');
      assert.equal(res2.data.ok, true);
      assert.equal(res2.data.version, 2);
    } finally {
      sdk.Databases.prototype.updateDocument = origUpdateDocument;
    }
  });

  // Test 27: Failed transition commit: Error is propagated and triggers recovery (no false 200 success)
  it('TEST-27: Failed transition commit: Error is propagated and triggers recovery (no false 200 success)', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'patient_alice' };

    const rxId = 'rx_fail_commit_test';
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${rxId}`, {
      $id: rxId,
      user_id: 'patient_alice',
      status: 'pending_review',
      ai_parsed_json: JSON.stringify({ version: 1 }),
      $permissions: ['read("user:patient_alice")'],
    });
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_dest`, {
      $id: 'pharm_dest', is_active: true, team_id: 'team_pharm_dest',
    });

    // Cause commitTransition update to fail
    const origUpdateDocument = sdk.Databases.prototype.updateDocument;
    sdk.Databases.prototype.updateDocument = async function(dbId, colId, docId, data, permissions) {
      if (docId.startsWith('tx_') && data.status === 'transition_committed') {
        throw new Error('Database disk full on commit transition');
      }
      return origUpdateDocument.call(this, dbId, colId, docId, data, permissions);
    };

    try {
      const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });

      const ctx = createMockExecutionContext({
        body: { action: 'route', prescription_id: rxId, pharmacy_id: 'pharm_dest' },
      });
      await handler(ctx);
      const res = ctx.getResult();

      // Must NOT return 200 success! Must return error and trigger rollback
      assert.notEqual(res.status, 200, 'Service must NOT return 200 success if commitTransition fails');
      assert.match(res.data.error, /Failed to commit transition document/);

      // Parent must have been restored or quarantined
      const parentDoc = sdk.store.documents.get(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${rxId}`);
      assert.equal(parentDoc.status, 'pending_review');
    } finally {
      sdk.Databases.prototype.updateDocument = origUpdateDocument;
    }
  });

  // Test 28: Cryptographic upload token enforcement: Missing, mismatched, or un-registered tokens rejected
  it('TEST-28: Cryptographic upload token enforcement: Missing, mismatched, or un-registered tokens rejected', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'patient_alice' };

    const fileId = 'img_token_enforce_test';
    const validToken = 'tok_valid_secret_123';
    sdk.store.files.set(`${TEST_ENV.STORAGE_BUCKET_ID}:${fileId}`, {
      $id: fileId,
      $permissions: ['read("user:patient_alice")', 'delete("user:patient_alice")'],
    });

    // Register upload with valid token in 'registered' status
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:upload_${fileId}`, {
      $id: `upload_${fileId}`,
      user_id: 'patient_alice',
      status: 'registered',
      image_id: fileId,
      ai_parsed_json: JSON.stringify({ upload_token: validToken, uploader_id: 'patient_alice' }),
    });

    const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });

    // Case 1: Missing upload_token
    const ctxMissing = createMockExecutionContext({
      body: { action: 'create', image_id: fileId, items: [{ drug_name: 'Med A' }] },
    });
    await handler(ctxMissing);
    assert.equal(ctxMissing.getResult().status, 400);
    assert.match(ctxMissing.getResult().data.error, /Missing required 'upload_token'/);

    // Case 2: Mismatched upload_token (timing-safe comparison rejected)
    const ctxMismatched = createMockExecutionContext({
      body: { action: 'create', image_id: fileId, upload_token: 'tok_forged_wrong', items: [{ drug_name: 'Med A' }] },
    });
    await handler(ctxMismatched);
    assert.equal(ctxMismatched.getResult().status, 403);
    assert.match(ctxMismatched.getResult().data.error, /Invalid or mismatched upload token/);

    // Case 3: Image that was never registered via prepare_upload
    const ctxUnregistered = createMockExecutionContext({
      body: { action: 'create', image_id: 'never_registered_img', upload_token: 'tok_any', items: [{ drug_name: 'Med A' }] },
    });
    await handler(ctxUnregistered);
    assert.equal(ctxUnregistered.getResult().status, 400);
    assert.match(ctxUnregistered.getResult().data.error, /must be registered via prepare_upload/);

    // Case 4: Upload reservation is in 'claimed' status (already used)
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:upload_already_claimed_file`, {
      $id: 'upload_already_claimed_file',
      user_id: 'patient_alice',
      status: 'claimed',
      image_id: 'already_claimed_file',
      ai_parsed_json: JSON.stringify({ upload_token: 'tok_valid_claimed', uploader_id: 'patient_alice' }),
    });
    const ctxAlreadyClaimed = createMockExecutionContext({
      body: { action: 'create', image_id: 'already_claimed_file', upload_token: 'tok_valid_claimed', items: [{ drug_name: 'Med A' }] },
    });
    await handler(ctxAlreadyClaimed);
    assert.equal(ctxAlreadyClaimed.getResult().status, 400);
    assert.match(ctxAlreadyClaimed.getResult().data.error, /must be 'registered'/);

    // Case 5: Successful creation transitions reservation status from 'registered' to 'claimed'
    const ctxSuccess = createMockExecutionContext({
      body: { action: 'create', image_id: fileId, upload_token: validToken, items: [{ drug_name: 'Med A' }] },
    });
    await handler(ctxSuccess);
    assert.equal(ctxSuccess.getResult().status, 201);
    const updatedUploadDoc = sdk.store.documents.get(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:upload_${fileId}`);
    assert.equal(updatedUploadDoc.status, 'claimed', 'Upload reservation must be transitioned to claimed');
  });

  // Test 29: Actual pharmacy-session access before and after reassignment
  it('TEST-29: Actual pharmacy-session access before and after reassignment', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'patient_alice' };

    const rxId = 'rx_pharm_access_test';
    const itemId = 'item_pharm_access_test';

    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_alpha`, {
      $id: 'pharm_alpha', is_active: true, team_id: 'team_alpha',
    });
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_beta`, {
      $id: 'pharm_beta', is_active: true, team_id: 'team_beta',
    });

    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${rxId}`, {
      $id: rxId,
      user_id: 'patient_alice',
      status: 'pending_review',
      ai_parsed_json: JSON.stringify({ version: 1 }),
      $permissions: ['read("user:patient_alice")', 'read("team:msh_admin_test")'],
    });

    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.ITEMS_COLLECTION_ID}:${itemId}`, {
      $id: itemId,
      prescription_id: rxId,
      drug_name: 'Amoxicillin 500mg',
      $permissions: ['read("user:patient_alice")', 'read("team:msh_admin_test")'],
    });

    const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });

    // 1. Route to Pharmacy Alpha
    const routeCtx = createMockExecutionContext({
      body: { action: 'route', prescription_id: rxId, pharmacy_id: 'pharm_alpha' },
    });
    await handler(routeCtx);
    assert.equal(routeCtx.getResult().status, 200);

    // Verify session permissions before reassignment:
    // Pharmacy Alpha HAS read access; Pharmacy Beta DOES NOT have read access
    const parentAfterRoute = sdk.store.documents.get(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${rxId}`);
    const itemAfterRoute = sdk.store.documents.get(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.ITEMS_COLLECTION_ID}:${itemId}`);

    assert.ok(parentAfterRoute.$permissions.includes('read("team:team_alpha")'), 'Pharmacy Alpha team granted parent read');
    assert.ok(itemAfterRoute.$permissions.includes('read("team:team_alpha")'), 'Pharmacy Alpha team granted item read');
    assert.ok(!parentAfterRoute.$permissions.includes('read("team:team_beta")'), 'Pharmacy Beta team lacks parent read');
    assert.ok(!itemAfterRoute.$permissions.includes('read("team:team_beta")'), 'Pharmacy Beta team lacks item read');

    // 2. Reassign to Pharmacy Beta
    const reassignCtx = createMockExecutionContext({
      body: { action: 'reassign', prescription_id: rxId, new_pharmacy_id: 'pharm_beta' },
    });
    await handler(reassignCtx);
    assert.equal(reassignCtx.getResult().status, 200);

    // Verify session permissions after reassignment:
    // Pharmacy Beta HAS read access; Pharmacy Alpha read access is REVOKED
    const parentAfterReassign = sdk.store.documents.get(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${rxId}`);
    const itemAfterReassign = sdk.store.documents.get(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.ITEMS_COLLECTION_ID}:${itemId}`);

    assert.ok(parentAfterReassign.$permissions.includes('read("team:team_beta")'), 'Pharmacy Beta team granted parent read');
    assert.ok(itemAfterReassign.$permissions.includes('read("team:team_beta")'), 'Pharmacy Beta team granted item read');
    assert.ok(!parentAfterReassign.$permissions.includes('read("team:team_alpha")'), 'Pharmacy Alpha team parent read REVOKED');
    assert.ok(!itemAfterReassign.$permissions.includes('read("team:team_alpha")'), 'Pharmacy Alpha team item read REVOKED');
  });

  // Test 30: Two workers reclaiming an aborted transition: Database uniqueness guarantees exactly one succeeds and one receives 409 without deleting any documents
  it('TEST-30: Two workers reclaiming an aborted transition: Database uniqueness guarantees exactly one succeeds and one receives 409 without deleting any documents', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'patient_alice' };

    const rxId = 'rx_reclaim_race_test';
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${rxId}`, {
      $id: rxId,
      user_id: 'patient_alice',
      status: 'pending_review',
      ai_parsed_json: JSON.stringify({ version: 1 }),
      $permissions: ['read("user:patient_alice")'],
    });
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_dest_a`, {
      $id: 'pharm_dest_a', is_active: true, team_id: 'team_pharm_a',
    });
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_dest_b`, {
      $id: 'pharm_dest_b', is_active: true, team_id: 'team_pharm_b',
    });

    // An aborted transition attempt 1 already exists in the store
    const txDocId1 = `tx_${rxId}_v2`;
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${txDocId1}`, {
      $id: txDocId1,
      user_id: 'patient_alice',
      status: 'transition_aborted',
      ai_parsed_json: JSON.stringify({ prescription_id: rxId, from_version: 1, to_version: 2, attempt: 1 }),
    });

    // Create TWO SEPARATE HANDLER INSTANCES (separate in-process locks) to test cross-worker DB coordination
    const worker1 = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
    const worker2 = createPrescriptionHandler({ ...sdk, env: TEST_ENV });

    const ctx1 = createMockExecutionContext({
      body: { action: 'route', prescription_id: rxId, pharmacy_id: 'pharm_dest_a' },
    });
    const ctx2 = createMockExecutionContext({
      body: { action: 'route', prescription_id: rxId, pharmacy_id: 'pharm_dest_b' },
    });

    // Both workers race to reclaim the aborted transition
    await Promise.all([worker1(ctx1), worker2(ctx2)]);

    const res1 = ctx1.getResult();
    const res2 = ctx2.getResult();
    const statuses = [res1.status, res2.status].sort();

    // Exactly one succeeds (200) and one receives 409 Conflict
    assert.equal(statuses[0], 200, 'One worker must succeed with 200');
    assert.equal(statuses[1], 409, 'One worker must be rejected with 409 Conflict');

    // CRITICAL: Verify that txDocId1 (attempt 1) was NEVER deleted (immutable tombstone)
    const txDoc1After = sdk.store.documents.get(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${txDocId1}`);
    assert.ok(txDoc1After, 'Aborted attempt 1 document must NOT be deleted');
    assert.equal(txDoc1After.status, 'transition_aborted', 'Attempt 1 remains transition_aborted');

    // Verify that attempt 2 document (txDocId2) was created and committed by the winning worker
    const txDocId2 = `tx_${rxId}_v2_a2`;
    const txDoc2After = sdk.store.documents.get(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${txDocId2}`);
    assert.ok(txDoc2After, 'Attempt 2 document must be created');
    assert.equal(txDoc2After.status, 'transition_committed', 'Attempt 2 document is committed');
  });

  // Test 31: Parent write commits but returns timeout: State reconciliation verifies committed parent state and completes cascade without releasing coordination
  it('TEST-31: Parent write commits but returns timeout: State reconciliation verifies committed parent state and completes cascade without releasing coordination', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'patient_alice' };

    const rxId = 'rx_timeout_commit_test';
    const itemId = 'item_timeout_commit_test';

    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${rxId}`, {
      $id: rxId,
      user_id: 'patient_alice',
      status: 'pending_review',
      ai_parsed_json: JSON.stringify({ version: 1 }),
      $permissions: ['read("user:patient_alice")'],
    });
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.ITEMS_COLLECTION_ID}:${itemId}`, {
      $id: itemId,
      prescription_id: rxId,
      drug_name: 'Amoxicillin 500mg',
      $permissions: ['read("user:patient_alice")'],
    });
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_dest`, {
      $id: 'pharm_dest', is_active: true, team_id: 'team_pharm_dest',
    });

    // Simulate: updateDocument commits the change into the database, but throws ETIMEDOUT on response
    const origUpdateDocument = sdk.Databases.prototype.updateDocument;
    let simulatedTimeoutOnce = true;
    sdk.Databases.prototype.updateDocument = async function(dbId, colId, docId, data, permissions) {
      if (docId === rxId && simulatedTimeoutOnce) {
        simulatedTimeoutOnce = false;
        // The write COMMITS on the database server:
        await origUpdateDocument.call(this, dbId, colId, docId, data, permissions);
        // But network response drops / times out:
        const timeoutErr = new Error('ETIMEDOUT: Connection timed out waiting for server response');
        timeoutErr.code = 'ETIMEDOUT';
        throw timeoutErr;
      }
      return origUpdateDocument.call(this, dbId, colId, docId, data, permissions);
    };

    try {
      const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });

      const ctx = createMockExecutionContext({
        body: { action: 'route', prescription_id: rxId, pharmacy_id: 'pharm_dest' },
      });
      await handler(ctx);
      const res = ctx.getResult();

      // Reconciliation verifies that parent committed -> operation completes successfully!
      assert.equal(res.status, 200, 'Must succeed with HTTP 200 through state reconciliation');
      assert.equal(res.data.ok, true);
      assert.equal(res.data.version, 2);

      // Verify child item was properly cascaded to the pharmacy team
      const itemAfter = sdk.store.documents.get(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.ITEMS_COLLECTION_ID}:${itemId}`);
      assert.ok(itemAfter.$permissions.includes('read("team:team_pharm_dest")'), 'Child item granted pharmacy read');

      // Verify transition was committed
      const txDoc = sdk.store.documents.get(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:tx_${rxId}_v2`);
      assert.equal(txDoc.status, 'transition_committed', 'Transition document is committed');
    } finally {
      sdk.Databases.prototype.updateDocument = origUpdateDocument;
    }
  });

  // Test 32: Parent write times out and reconciliation fails (uncertain outcome): Transition is locked in transition_recovering to prevent concurrent writes
  it('TEST-32: Parent write times out and reconciliation fails (uncertain outcome): Transition is locked in transition_recovering to prevent concurrent writes', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'patient_alice' };

    const rxId = 'rx_uncertain_write_test';
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${rxId}`, {
      $id: rxId,
      user_id: 'patient_alice',
      status: 'pending_review',
      ai_parsed_json: JSON.stringify({ version: 1 }),
      $permissions: ['read("user:patient_alice")'],
    });
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_dest`, {
      $id: 'pharm_dest', is_active: true, team_id: 'team_pharm_dest',
    });

    // Simulate: parent update fails AND subsequent getDocument also fails (complete network partition)
    const origUpdateDocument = sdk.Databases.prototype.updateDocument;
    const origGetDocument = sdk.Databases.prototype.getDocument;

    let failGetRx = false;
    sdk.Databases.prototype.updateDocument = async function(dbId, colId, docId, data, permissions) {
      if (docId === rxId) {
        failGetRx = true;
        throw new Error('ETIMEDOUT: Connection timed out');
      }
      return origUpdateDocument.call(this, dbId, colId, docId, data, permissions);
    };

    sdk.Databases.prototype.getDocument = async function(dbId, colId, docId) {
      if (docId === rxId && failGetRx) {
        throw new Error('ETIMEDOUT: Cannot reach database server to reconcile');
      }
      return origGetDocument.call(this, dbId, colId, docId);
    };

    try {
      const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });

      const ctx = createMockExecutionContext({
        body: { action: 'route', prescription_id: rxId, pharmacy_id: 'pharm_dest' },
      });
      await handler(ctx);
      const res = ctx.getResult();

      assert.equal(res.status, 500, 'Must return 500 when state cannot be reconciled');

      // The transition document must be locked in transition_recovering to fence off subsequent writes
      const txDoc = sdk.store.documents.get(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:tx_${rxId}_v2`);
      assert.equal(txDoc.status, 'transition_recovering', 'Transition must remain in transition_recovering');

      // Subsequent attempt by another worker is blocked with 409 Conflict
      failGetRx = false; // Restore getDocument
      const worker2 = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
      const ctx2 = createMockExecutionContext({
        body: { action: 'route', prescription_id: rxId, pharmacy_id: 'pharm_dest' },
      });
      await worker2(ctx2);
      assert.equal(ctx2.getResult().status, 409, 'Subsequent worker must be blocked with 409 Conflict while state is recovering');
    } finally {
      sdk.Databases.prototype.updateDocument = origUpdateDocument;
      sdk.Databases.prototype.getDocument = origGetDocument;
    }
  });

  // Test 33: Transition commit succeeds, its response is lost, and a second worker starts before first worker enters recovery
  it('TEST-33: Transition commit succeeds, its response is lost, and a second worker starts before first worker enters recovery: Rollback is prevented and successor state is preserved', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'patient_alice' };

    const rxId = 'rx_commit_timeout_successor_test';
    const itemId = 'item_commit_timeout_successor_test';

    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_dest_a`, {
      $id: 'pharm_dest_a', is_active: true, team_id: 'team_pharm_a',
    });
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_dest_b`, {
      $id: 'pharm_dest_b', is_active: true, team_id: 'team_pharm_b',
    });

    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${rxId}`, {
      $id: rxId,
      user_id: 'patient_alice',
      status: 'pending_review',
      ai_parsed_json: JSON.stringify({ version: 1 }),
      $permissions: ['read("user:patient_alice")'],
    });

    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.ITEMS_COLLECTION_ID}:${itemId}`, {
      $id: itemId,
      prescription_id: rxId,
      drug_name: 'Amoxicillin 500mg',
      $permissions: ['read("user:patient_alice")'],
    });

    const origUpdateDocument = sdk.Databases.prototype.updateDocument;
    let simulateCommitResponseLoss = true;

    // Separate worker instances (distinct local mutex locks)
    const worker1 = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
    const worker2 = createPrescriptionHandler({ ...sdk, env: TEST_ENV });

    sdk.Databases.prototype.updateDocument = async function(dbId, colId, docId, data, permissions) {
      if (docId === `tx_${rxId}_v2` && data.status === 'transition_committed' && simulateCommitResponseLoss) {
        simulateCommitResponseLoss = false;
        // The commit write SUCCEEDS in the database:
        await origUpdateDocument.call(this, dbId, colId, docId, data, permissions);

        // BEFORE Worker 1 receives the response or enters recovery, Worker 2 runs and reassigns to pharm_dest_b (version 3)!
        const ctx2 = createMockExecutionContext({
          body: { action: 'reassign', prescription_id: rxId, new_pharmacy_id: 'pharm_dest_b' },
        });
        await worker2(ctx2);
        const res2 = ctx2.getResult();
        assert.equal(res2.status, 200, 'Worker 2 must successfully reassign to version 3');
        assert.equal(res2.data.version, 3);

        // Now Worker 1 experiences response drop / timeout from its commit request
        const timeoutErr = new Error('ETIMEDOUT: Server response timed out on transition commit');
        timeoutErr.code = 'ETIMEDOUT';
        throw timeoutErr;
      }
      return origUpdateDocument.call(this, dbId, colId, docId, data, permissions);
    };

    try {
      const ctx1 = createMockExecutionContext({
        body: { action: 'route', prescription_id: rxId, pharmacy_id: 'pharm_dest_a' },
      });
      await worker1(ctx1);
      const res1 = ctx1.getResult();

      // Worker 1 must NOT roll back Worker 2's version 3 state!
      // Worker 1's recovery detects that tx_..._v2 was either committed or parent was superseded by version 3
      assert.ok(
        res1.status === 200 || (res1.status === 409 && res1.data.fencingConflict === true),
        `Worker 1 must either reconcile committed (200) or report fencing conflict (409), got ${res1.status}`
      );

      // Verify prescription is STILL at version 3 with pharmacy_dest_b!
      const parentAfter = sdk.store.documents.get(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${rxId}`);
      const parentMeta = JSON.parse(parentAfter.ai_parsed_json);
      assert.equal(parentMeta.version, 3, 'Prescription must remain at version 3 (not rolled back)');
      assert.equal(parentAfter.pharmacy_id, 'pharm_dest_b', 'Prescription must remain assigned to Worker 2 pharmacy');
      assert.ok(parentAfter.$permissions.includes('read("team:team_pharm_b")'), 'Prescription retains Worker 2 permissions');
      assert.ok(!parentAfter.ai_parsed_json.includes('"quarantined":true'), 'Prescription must NOT be quarantined');

      // Verify child item retains Worker 2 pharmacy permissions
      const itemAfter = sdk.store.documents.get(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.ITEMS_COLLECTION_ID}:${itemId}`);
      assert.ok(itemAfter.$permissions.includes('read("team:team_pharm_b")'), 'Child item retains Worker 2 pharmacy permissions');
    } finally {
      sdk.Databases.prototype.updateDocument = origUpdateDocument;
    }
  });

  // Test 34: Parent update times out, reconciliation initially sees old state, and original write completes later
  it('TEST-34: Parent update times out, reconciliation initially sees old state, and original write completes later: Transition is held in transition_recovering and subsequent operations are blocked with 409 Conflict', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'patient_alice' };

    const rxId = 'rx_delayed_parent_write_test';
    const itemId = 'item_delayed_parent_write_test';

    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_dest`, {
      $id: 'pharm_dest', is_active: true, team_id: 'team_pharm_dest',
    });

    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${rxId}`, {
      $id: rxId,
      user_id: 'patient_alice',
      status: 'pending_review',
      ai_parsed_json: JSON.stringify({ version: 1 }),
      $permissions: ['read("user:patient_alice")'],
    });

    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.ITEMS_COLLECTION_ID}:${itemId}`, {
      $id: itemId,
      prescription_id: rxId,
      drug_name: 'Amoxicillin 500mg',
      $permissions: ['read("user:patient_alice")'],
    });

    const origUpdateDocument = sdk.Databases.prototype.updateDocument;
    let simulateParentTimeoutOnce = true;
    let delayedWritePayload = null;

    // Intercept updateDocument on parent to simulate timeout before commit, followed by delayed commit
    sdk.Databases.prototype.updateDocument = async function(dbId, colId, docId, data, permissions) {
      if (docId === rxId && simulateParentTimeoutOnce) {
        simulateParentTimeoutOnce = false;
        // Save payload to apply later (simulating delayed completion on database server)
        delayedWritePayload = { dbId, colId, docId, data, permissions };
        // At this instant, the server write has NOT finished, and client connection times out:
        const timeoutErr = new Error('ETIMEDOUT: Connection timed out waiting for server response');
        timeoutErr.code = 'ETIMEDOUT';
        throw timeoutErr;
      }
      return origUpdateDocument.call(this, dbId, colId, docId, data, permissions);
    };

    try {
      const worker1 = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
      const worker2 = createPrescriptionHandler({ ...sdk, env: TEST_ENV });

      const ctx1 = createMockExecutionContext({
        body: { action: 'route', prescription_id: rxId, pharmacy_id: 'pharm_dest' },
      });
      await worker1(ctx1);
      const res1 = ctx1.getResult();

      // 1. Worker 1 receives 500 with uncertain_outcome: true
      assert.equal(res1.status, 500, 'Must return 500 on uncertain parent write outcome');
      assert.equal(res1.data.uncertain_outcome, true, 'Response must identify outcome as uncertain');

      // 2. CRITICAL: The transition document MUST remain in transition_recovering (NOT transition_aborted!)
      const txDoc = sdk.store.documents.get(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:tx_${rxId}_v2`);
      assert.ok(txDoc, 'Transition document must exist');
      assert.equal(txDoc.status, 'transition_recovering', 'Transition must remain locked in transition_recovering');

      // 3. NOW the delayed write finishes on the database server!
      assert.ok(delayedWritePayload, 'Delayed write payload must have been captured');
      await origUpdateDocument.call(
        this,
        delayedWritePayload.dbId,
        delayedWritePayload.colId,
        delayedWritePayload.docId,
        delayedWritePayload.data,
        delayedWritePayload.permissions
      );

      // Verify parent in database is now updated with active_tx: tx_..._v2
      const parentAfterDelayed = sdk.store.documents.get(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${rxId}`);
      const metaAfterDelayed = JSON.parse(parentAfterDelayed.ai_parsed_json);
      assert.equal(metaAfterDelayed.version, 2, 'Delayed write updated version to 2');
      assert.equal(metaAfterDelayed.active_tx, `tx_${rxId}_v2`, 'Delayed write set active_tx');

      // 4. A subsequent worker (Worker 2) attempts an operation on this prescription
      const ctx2 = createMockExecutionContext({
        body: { action: 'route', prescription_id: rxId, pharmacy_id: 'pharm_dest' },
      });
      await worker2(ctx2);
      const res2 = ctx2.getResult();

      // 5. Worker 2 MUST BE BLOCKED with HTTP 409 Conflict because tx_..._v2 is in transition_recovering!
      assert.equal(res2.status, 409, 'Subsequent worker must be blocked with 409 Conflict');
      assert.match(res2.data.error, /Conflict: A concurrent routing operation is already in progress or recovering/);
    } finally {
      sdk.Databases.prototype.updateDocument = origUpdateDocument;
    }
  });

  // Test 35: Parent update error surfaces transitionStatusError when setTransitionStatus fails
  it('TEST-35: Parent update error surfaces transitionStatusError when setTransitionStatus fails', async () => {
    const sdk = createMockSdkState();
    sdk.store.callerAccount = { $id: 'patient_alice' };

    const rxId = 'rx_status_err_surface_test';
    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_dest`, {
      $id: 'pharm_dest', is_active: true, team_id: 'team_pharm_dest',
    });

    sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${rxId}`, {
      $id: rxId,
      user_id: 'patient_alice',
      status: 'pending_review',
      ai_parsed_json: JSON.stringify({ version: 1 }),
      $permissions: ['read("user:patient_alice")'],
    });

    const origUpdateDocument = sdk.Databases.prototype.updateDocument;
    // Parent update fails with timeout, AND setting transition status also fails
    sdk.Databases.prototype.updateDocument = async function(dbId, colId, docId, data, permissions) {
      if (docId === rxId) {
        throw new Error('ETIMEDOUT: Parent update timed out');
      }
      if (docId.startsWith('tx_') && data.status === 'transition_recovering') {
        throw new Error('Simulated failure updating transition status to transition_recovering');
      }
      return origUpdateDocument.call(this, dbId, colId, docId, data, permissions);
    };

    try {
      const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
      const ctx = createMockExecutionContext({
        body: { action: 'route', prescription_id: rxId, pharmacy_id: 'pharm_dest' },
      });
      await handler(ctx);
      const res = ctx.getResult();

      assert.equal(res.status, 500, 'Must return 500');
      assert.ok(res.data.transitionStatusError, 'Response must surface transitionStatusError');
      assert.match(res.data.transitionStatusError, /Failed to update transition document/);
    } finally {
      sdk.Databases.prototype.updateDocument = origUpdateDocument;
    }
  });

  // Test 36: Stop recovery when coordination state is unknown
  // If parent/transition cannot be read, or entering transition_recovering fails, do not proceed with rollback or quarantine writes
  describe('TEST-36: Stop recovery when coordination state is unknown', () => {
    it('36A: Halts recovery immediately without rollback/quarantine writes when parent cannot be read', async () => {
      const sdk = createMockSdkState();
      sdk.store.callerAccount = { $id: 'patient_alice' };
      const rxId = 'rx_unknown_coord_parent_fail';
      const itemId = 'item_unknown_coord_parent_fail';

      sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_dest`, {
        $id: 'pharm_dest', is_active: true, team_id: 'team_pharm_dest',
      });
      sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${rxId}`, {
        $id: rxId, user_id: 'patient_alice', status: 'pending_review',
        ai_parsed_json: JSON.stringify({ version: 1 }),
        $permissions: ['read("user:patient_alice")'],
      });
      sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.ITEMS_COLLECTION_ID}:${itemId}`, {
        $id: itemId, prescription_id: rxId, drug_name: 'Drug 1',
        $permissions: ['read("user:patient_alice")'],
      });

      const origGetDocument = sdk.Databases.prototype.getDocument;
      const origUpdateDocument = sdk.Databases.prototype.updateDocument;
      let recoveryWritesAttempted = 0;
      let parentUpdateSucceeded = false;

      // Make child item update fail to trigger cascade error
      sdk.Databases.prototype.updateDocument = async function(dbId, colId, docId, data, perms) {
        if (colId === TEST_ENV.PRESCRIPTIONS_COLLECTION_ID && docId === rxId && !parentUpdateSucceeded) {
          parentUpdateSucceeded = true;
          return origUpdateDocument.call(this, dbId, colId, docId, data, perms);
        }
        if (colId === TEST_ENV.ITEMS_COLLECTION_ID) {
          throw new Error('Simulated cascade child failure');
        }
        recoveryWritesAttempted++;
        return origUpdateDocument.call(this, dbId, colId, docId, data, perms);
      };

      // In recovery, reading parent throws
      sdk.Databases.prototype.getDocument = async function(dbId, colId, docId) {
        if (parentUpdateSucceeded && colId === TEST_ENV.PRESCRIPTIONS_COLLECTION_ID && docId === rxId) {
          throw new Error('Database connection dropped while reading parent');
        }
        return origGetDocument.call(this, dbId, colId, docId);
      };

      try {
        const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
        const ctx = createMockExecutionContext({
          body: { action: 'route', prescription_id: rxId, pharmacy_id: 'pharm_dest' },
        });
        await handler(ctx);
        const res = ctx.getResult();

        assert.equal(res.status, 500, 'Must return HTTP 500');
        assert.equal(res.data.ok, false);
        assert.equal(res.data.recoveryHalted, true, 'Recovery must be explicitly marked halted');
        assert.equal(res.data.coordinationStateUnknown, true, 'coordinationStateUnknown must be true');
        assert.match(res.data.error, /Recovery halted: failed to read parent prescription state/);
        assert.equal(recoveryWritesAttempted, 0, 'Zero rollback or quarantine writes must be executed when parent read fails');
      } finally {
        sdk.Databases.prototype.getDocument = origGetDocument;
        sdk.Databases.prototype.updateDocument = origUpdateDocument;
      }
    });

    it('36B: Halts recovery immediately without rollback/quarantine writes when transition document cannot be read', async () => {
      const sdk = createMockSdkState();
      sdk.store.callerAccount = { $id: 'patient_alice' };
      const rxId = 'rx_unknown_coord_tx_fail';
      const itemId = 'item_unknown_coord_tx_fail';

      sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_dest`, {
        $id: 'pharm_dest', is_active: true, team_id: 'team_pharm_dest',
      });
      sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${rxId}`, {
        $id: rxId, user_id: 'patient_alice', status: 'pending_review',
        ai_parsed_json: JSON.stringify({ version: 1 }),
        $permissions: ['read("user:patient_alice")'],
      });
      sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.ITEMS_COLLECTION_ID}:${itemId}`, {
        $id: itemId, prescription_id: rxId, drug_name: 'Drug 1',
        $permissions: ['read("user:patient_alice")'],
      });

      const origGetDocument = sdk.Databases.prototype.getDocument;
      const origUpdateDocument = sdk.Databases.prototype.updateDocument;
      let recoveryWritesAttempted = 0;
      let parentUpdateSucceeded = false;

      sdk.Databases.prototype.updateDocument = async function(dbId, colId, docId, data, perms) {
        if (colId === TEST_ENV.PRESCRIPTIONS_COLLECTION_ID && docId === rxId && !parentUpdateSucceeded) {
          parentUpdateSucceeded = true;
          return origUpdateDocument.call(this, dbId, colId, docId, data, perms);
        }
        if (colId === TEST_ENV.ITEMS_COLLECTION_ID) {
          throw new Error('Simulated cascade child failure');
        }
        recoveryWritesAttempted++;
        return origUpdateDocument.call(this, dbId, colId, docId, data, perms);
      };

      // In recovery, reading transition doc throws
      sdk.Databases.prototype.getDocument = async function(dbId, colId, docId) {
        if (parentUpdateSucceeded && colId === TEST_ENV.PRESCRIPTIONS_COLLECTION_ID && docId.startsWith('tx_')) {
          throw new Error('Database transport error reading transition doc');
        }
        return origGetDocument.call(this, dbId, colId, docId);
      };

      try {
        const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
        const ctx = createMockExecutionContext({
          body: { action: 'route', prescription_id: rxId, pharmacy_id: 'pharm_dest' },
        });
        await handler(ctx);
        const res = ctx.getResult();

        assert.equal(res.status, 500, 'Must return HTTP 500');
        assert.equal(res.data.ok, false);
        assert.equal(res.data.recoveryHalted, true, 'Recovery must be explicitly marked halted');
        assert.equal(res.data.coordinationStateUnknown, true, 'coordinationStateUnknown must be true');
        assert.match(res.data.error, /Recovery halted: failed to read transition document state/);
        assert.equal(recoveryWritesAttempted, 0, 'Zero rollback or quarantine writes must be executed when transition read fails');
      } finally {
        sdk.Databases.prototype.getDocument = origGetDocument;
        sdk.Databases.prototype.updateDocument = origUpdateDocument;
      }
    });

    it('36C: Halts recovery immediately without rollback/quarantine writes when entering transition_recovering fails', async () => {
      const sdk = createMockSdkState();
      sdk.store.callerAccount = { $id: 'patient_alice' };
      const rxId = 'rx_unknown_coord_lock_fail';
      const itemId = 'item_unknown_coord_lock_fail';

      sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_dest`, {
        $id: 'pharm_dest', is_active: true, team_id: 'team_pharm_dest',
      });
      sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${rxId}`, {
        $id: rxId, user_id: 'patient_alice', status: 'pending_review',
        ai_parsed_json: JSON.stringify({ version: 1 }),
        $permissions: ['read("user:patient_alice")'],
      });
      sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.ITEMS_COLLECTION_ID}:${itemId}`, {
        $id: itemId, prescription_id: rxId, drug_name: 'Drug 1',
        $permissions: ['read("user:patient_alice")'],
      });

      const origUpdateDocument = sdk.Databases.prototype.updateDocument;
      let rollbackWritesAttempted = 0;
      let parentUpdateSucceeded = false;

      sdk.Databases.prototype.updateDocument = async function(dbId, colId, docId, data, perms) {
        if (colId === TEST_ENV.PRESCRIPTIONS_COLLECTION_ID && docId === rxId && !parentUpdateSucceeded) {
          parentUpdateSucceeded = true;
          return origUpdateDocument.call(this, dbId, colId, docId, data, perms);
        }
        if (colId === TEST_ENV.ITEMS_COLLECTION_ID) {
          throw new Error('Simulated cascade child failure');
        }
        // When setting transition status to transition_recovering:
        if (docId.startsWith('tx_') && data?.status === 'transition_recovering') {
          throw new Error('ETIMEDOUT: Failed to lock transition in transition_recovering');
        }
        // If recovery proceeds to rollback:
        rollbackWritesAttempted++;
        return origUpdateDocument.call(this, dbId, colId, docId, data, perms);
      };

      try {
        const handler = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
        const ctx = createMockExecutionContext({
          body: { action: 'route', prescription_id: rxId, pharmacy_id: 'pharm_dest' },
        });
        await handler(ctx);
        const res = ctx.getResult();

        assert.equal(res.status, 500, 'Must return HTTP 500');
        assert.equal(res.data.ok, false);
        assert.equal(res.data.recoveryHalted, true, 'Recovery must be marked halted');
        assert.ok(res.data.transitionStatusError, 'Must surface transitionStatusError');
        assert.match(res.data.error, /Recovery halted: failed to lock transition in transition_recovering/);
        assert.equal(rollbackWritesAttempted, 0, 'Zero rollback or quarantine writes must be executed when entering transition_recovering fails');
      } finally {
        sdk.Databases.prototype.updateDocument = origUpdateDocument;
      }
    });
  });

  // Test 37: Keep failed recovery blocking
  // Do not mark a transition transition_aborted when restoration or quarantine remains unsuccessful
  describe('TEST-37: Keep failed recovery blocking', () => {
    it('37A: Unsuccessful parent restoration leaves transition in transition_recovering and blocks subsequent operations with 409 Conflict', async () => {
      const sdk = createMockSdkState();
      sdk.store.callerAccount = { $id: 'patient_alice' };
      const rxId = 'rx_failed_recovery_parent_block';
      const item1Id = 'item1_parent_block';
      const item2Id = 'item2_parent_block';

      sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_dest`, {
        $id: 'pharm_dest', is_active: true, team_id: 'team_pharm_dest',
      });
      sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${rxId}`, {
        $id: rxId, user_id: 'patient_alice', status: 'pending_review',
        ai_parsed_json: JSON.stringify({ version: 1 }),
        $permissions: ['read("user:patient_alice")'],
      });
      sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.ITEMS_COLLECTION_ID}:${item1Id}`, {
        $id: item1Id, prescription_id: rxId, drug_name: 'Drug 1',
        $permissions: ['read("user:patient_alice")'],
      });
      sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.ITEMS_COLLECTION_ID}:${item2Id}`, {
        $id: item2Id, prescription_id: rxId, drug_name: 'Drug 2',
        $permissions: ['read("user:patient_alice")'],
      });

      const origUpdateDocument = sdk.Databases.prototype.updateDocument;
      let parentUpdateDone = false;

      sdk.Databases.prototype.updateDocument = async function(dbId, colId, docId, data, perms) {
        if (colId === TEST_ENV.PRESCRIPTIONS_COLLECTION_ID && docId === rxId && !parentUpdateDone) {
          parentUpdateDone = true;
          return origUpdateDocument.call(this, dbId, colId, docId, data, perms);
        }
        if (colId === TEST_ENV.ITEMS_COLLECTION_ID && docId === item2Id) {
          throw new Error('Cascade failure on item2');
        }
        // During rollback recovery:
        if (colId === TEST_ENV.PRESCRIPTIONS_COLLECTION_ID && docId === rxId && parentUpdateDone) {
          throw new Error('Simulated parent rollback and quarantine disk write error');
        }
        return origUpdateDocument.call(this, dbId, colId, docId, data, perms);
      };

      try {
        const worker1 = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
        const ctx1 = createMockExecutionContext({
          body: { action: 'route', prescription_id: rxId, pharmacy_id: 'pharm_dest' },
        });
        await worker1(ctx1);
        const res1 = ctx1.getResult();

        assert.equal(res1.status, 500, 'Worker 1 must return 500 on unsuccessful recovery');
        assert.equal(res1.data.ok, false);
        assert.equal(res1.data.recoveryBlocked, true, 'Response must indicate recovery is blocked');
        assert.match(res1.data.error, /recovery was unsuccessful.*Transition remains blocked in transition_recovering/);

        // Verify the transition document in the database
        const txDoc = sdk.store.documents.get(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:tx_${rxId}_v2`);
        assert.ok(txDoc, 'Transition document must exist');
        assert.equal(txDoc.status, 'transition_recovering', 'Transition MUST NOT be marked transition_aborted; must remain transition_recovering');
        assert.notEqual(txDoc.status, 'transition_aborted', 'Transition MUST NOT be transition_aborted');
        const txMeta = JSON.parse(txDoc.ai_parsed_json);
        assert.equal(txMeta.recovery_failed, true, 'Transition meta must record recovery_failed: true');

        // Now Worker 2 attempts an operation on the same prescription
        const worker2 = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
        const ctx2 = createMockExecutionContext({
          body: { action: 'route', prescription_id: rxId, pharmacy_id: 'pharm_dest' },
        });
        await worker2(ctx2);
        const res2 = ctx2.getResult();

        // Worker 2 MUST BE REJECTED WITH HTTP 409 CONFLICT!
        assert.equal(res2.status, 409, 'Subsequent worker must be blocked with HTTP 409 Conflict');
        assert.equal(res2.data.ok, false);
        assert.match(res2.data.error, /Conflict: A concurrent routing operation is already in progress or recovering/);
      } finally {
        sdk.Databases.prototype.updateDocument = origUpdateDocument;
      }
    });

    it('37B: Unsuccessful child restoration and quarantine failure leaves transition in transition_recovering and blocks subsequent operations with 409 Conflict', async () => {
      const sdk = createMockSdkState();
      sdk.store.callerAccount = { $id: 'patient_alice' };
      const rxId = 'rx_failed_child_recovery_block';
      const item1Id = 'item1_child_block';
      const item2Id = 'item2_child_block';

      sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PHARMACIES_COLLECTION_ID}:pharm_dest`, {
        $id: 'pharm_dest', is_active: true, team_id: 'team_pharm_dest',
      });
      sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:${rxId}`, {
        $id: rxId, user_id: 'patient_alice', status: 'pending_review',
        ai_parsed_json: JSON.stringify({ version: 1 }),
        $permissions: ['read("user:patient_alice")'],
      });
      sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.ITEMS_COLLECTION_ID}:${item1Id}`, {
        $id: item1Id, prescription_id: rxId, drug_name: 'Drug 1',
        $permissions: ['read("user:patient_alice")'],
      });
      sdk.store.documents.set(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.ITEMS_COLLECTION_ID}:${item2Id}`, {
        $id: item2Id, prescription_id: rxId, drug_name: 'Drug 2',
        $permissions: ['read("user:patient_alice")'],
      });

      const origUpdateDocument = sdk.Databases.prototype.updateDocument;
      let parentUpdateDone = false;
      let cascadeItem1Done = false;

      sdk.Databases.prototype.updateDocument = async function(dbId, colId, docId, data, perms) {
        if (colId === TEST_ENV.PRESCRIPTIONS_COLLECTION_ID && docId === rxId && !parentUpdateDone) {
          parentUpdateDone = true;
          return origUpdateDocument.call(this, dbId, colId, docId, data, perms);
        }
        if (colId === TEST_ENV.ITEMS_COLLECTION_ID && docId === item1Id && !cascadeItem1Done) {
          cascadeItem1Done = true;
          return origUpdateDocument.call(this, dbId, colId, docId, data, perms);
        }
        if (colId === TEST_ENV.ITEMS_COLLECTION_ID && docId === item2Id) {
          throw new Error('Cascade failure on item2');
        }
        // During rollback: parent restores ok, but child item 1 restore throws, and quarantine also throws!
        if (colId === TEST_ENV.ITEMS_COLLECTION_ID && docId === item1Id && cascadeItem1Done) {
          throw new Error('Simulated child restore and quarantine failure');
        }
        return origUpdateDocument.call(this, dbId, colId, docId, data, perms);
      };

      try {
        const worker1 = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
        const ctx1 = createMockExecutionContext({
          body: { action: 'route', prescription_id: rxId, pharmacy_id: 'pharm_dest' },
        });
        await worker1(ctx1);
        const res1 = ctx1.getResult();

        assert.equal(res1.status, 500, 'Worker 1 must return 500 on child recovery failure');
        assert.equal(res1.data.ok, false);
        assert.equal(res1.data.recoveryBlocked, true, 'Response must indicate recovery is blocked');
        assert.match(res1.data.error, /recovery was unsuccessful.*Transition remains blocked in transition_recovering/);

        // Verify transition document is still transition_recovering (NOT transition_aborted)
        const txDoc = sdk.store.documents.get(`${TEST_ENV.DATABASE_ID}:${TEST_ENV.PRESCRIPTIONS_COLLECTION_ID}:tx_${rxId}_v2`);
        assert.ok(txDoc, 'Transition document must exist');
        assert.equal(txDoc.status, 'transition_recovering', 'Transition MUST NOT be transition_aborted');
        assert.notEqual(txDoc.status, 'transition_aborted');

        // Worker 2 attempts an operation on the same prescription
        const worker2 = createPrescriptionHandler({ ...sdk, env: TEST_ENV });
        const ctx2 = createMockExecutionContext({
          body: { action: 'route', prescription_id: rxId, pharmacy_id: 'pharm_dest' },
        });
        await worker2(ctx2);
        const res2 = ctx2.getResult();

        assert.equal(res2.status, 409, 'Subsequent worker must be blocked with HTTP 409 Conflict');
        assert.equal(res2.data.ok, false);
        assert.match(res2.data.error, /Conflict: A concurrent routing operation is already in progress or recovering/);
      } finally {
        sdk.Databases.prototype.updateDocument = origUpdateDocument;
      }
    });
  });

});




