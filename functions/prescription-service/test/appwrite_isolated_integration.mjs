// test/appwrite_isolated_integration.mjs
// Dedicated Live & Isolated Integration Test Suite for Hardened Prescription Service
// Targets ONLY the isolated Test Database (6a6b3a780027d54e9b36) and synthetic test fixtures.
// Strictly rejects execution against production resources.
// DOES NOT USE MOCK DRIVERS OR IN-MEMORY MAPS.
// Contacts live Appwrite Cloud services via the official node-appwrite SDK.

import {
  Client,
  Databases,
  Storage,
  Teams,
  Users,
  Account,
  Functions,
  ID,
  Query,
  Permission,
  Role,
} from 'node-appwrite';
import { createPrescriptionHandler } from '../src/main.js';

// Production safety blacklist - strictly prohibited from live test targeting
const PROD_RESOURCES = [
  'medicine_support_hub',
  'prescription-images',
  '6a69695400002dade84d', // production database ID
];

// Configuration
const ENDPOINT = process.env.APPWRITE_FUNCTION_API_ENDPOINT || 'https://fra.cloud.appwrite.io/v1';
const PROJECT_ID = process.env.APPWRITE_FUNCTION_PROJECT_ID || '6a54ac3a00272c02d6e0';
const API_KEY = process.env.APPWRITE_API_KEY;
const TEST_DATABASE_ID = process.env.TEST_DATABASE_ID || '6a6b3a780027d54e9b36';
const TEST_MGMT_TEAM = process.env.TEST_MANAGEMENT_TEAM_ID || 'msh_admin_test';
const TEST_RX_COL = process.env.TEST_PRESCRIPTIONS_COLLECTION_ID || 'prescriptions';
const TEST_ITEMS_COL = process.env.TEST_ITEMS_COLLECTION_ID || 'prescription_items';
const TEST_PHARM_COL = process.env.TEST_PHARMACIES_COLLECTION_ID || 'pharmacies';
const TEST_BUCKET = process.env.TEST_STORAGE_BUCKET_ID || 'prescription-images-test';
const DEPLOYED_FUNCTION_ID = process.env.APPWRITE_FUNCTION_ID;

// -----------------------------------------------------------------------------
// PRE-FLIGHT VALIDATION: Safety Guard
// -----------------------------------------------------------------------------
const targetResources = [TEST_DATABASE_ID, TEST_MGMT_TEAM, TEST_BUCKET];
for (const res of targetResources) {
  if (PROD_RESOURCES.includes(res)) {
    console.error(`FATAL SECURITY ABORT: Target resource '${res}' matches production resource ID!`);
    console.error('Live integration testing is strictly restricted to isolated test environments.');
    process.exit(1);
  }
}

// -----------------------------------------------------------------------------
// PRE-FLIGHT VALIDATION: Require Live Appwrite Credentials
// -----------------------------------------------------------------------------
if (!API_KEY || !API_KEY.trim()) {
  console.log('========================================================================');
  console.log('APPWRITE LIVE INTEGRATION SUITE - CREDENTIAL CHECK');
  console.log('========================================================================');
  console.log('[INFO] APPWRITE_API_KEY is not set in environment.');
  console.log('');
  console.log('This suite executes against live Appwrite Cloud services with zero mocks.');
  console.log('To run this live suite against the isolated test database, provide credentials:');
  console.log('  export APPWRITE_API_KEY="<api_key>"');
  console.log('  export APPWRITE_FUNCTION_PROJECT_ID="6a54ac3a00272c02d6e0"');
  console.log('  export APPWRITE_FUNCTION_API_ENDPOINT="https://fra.cloud.appwrite.io/v1"');
  console.log('  export TEST_DATABASE_ID="6a6b3a780027d54e9b36"');
  console.log('  npm run test:integration');
  console.log('');
  console.log('For simulated multi-worker concurrency and unit test coverage, run:');
  console.log('  npm test');
  console.log('========================================================================');
  process.exit(1);
}

// Result Tracker
let passedAssertions = 0;
let failedAssertions = 0;
const results = [];

function assertTest(id, description, condition, details = {}) {
  if (condition) {
    passedAssertions++;
    console.log(`  [PASS] ${id}: ${description}`);
    results.push({ id, description, passed: true, details });
  } else {
    failedAssertions++;
    console.error(`  [FAIL] ${id}: ${description}`);
    console.error('         Details:', JSON.stringify(details));
    results.push({ id, description, passed: false, details });
  }
}

function createExecutionContext(options = {}) {
  let responseData = null;
  let responseStatus = 200;

  return {
    req: {
      headers: {
        'x-appwrite-user-jwt': options.jwt || '',
        'x-appwrite-key': options.apiKey || API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify(options.body || {}),
    },
    res: {
      json: (data, status = 200) => {
        responseData = data;
        responseStatus = status;
        return { data, status };
      },
      text: (text, status = 200) => {
        responseData = text;
        responseStatus = status;
        return { data: text, status };
      },
    },
    log: (msg) => {
      if (process.env.DEBUG) console.log(`[SERVICE_LOG] ${msg}`);
    },
    error: (msg) => {
      if (process.env.DEBUG) console.error(`[SERVICE_ERR] ${msg}`);
    },
    getResult: () => ({ status: responseStatus, data: responseData }),
  };
}

async function runLiveIntegrationSuite() {
  console.log('========================================================================');
  console.log('RUNNING LIVE APPWRITE INTEGRATION SUITE');
  console.log(`Endpoint:    ${ENDPOINT}`);
  console.log(`Project ID:  ${PROJECT_ID}`);
  console.log(`Database ID: ${TEST_DATABASE_ID} (ISOLATED TEST DATABASE)`);
  console.log(`Bucket ID:   ${TEST_BUCKET} (ISOLATED TEST STORAGE)`);
  console.log('Driver:      Genuine node-appwrite SDK (Direct Live Appwrite Cloud)');
  console.log('========================================================================\n');

  // Initialize real Appwrite admin client
  const adminClient = new Client()
    .setEndpoint(ENDPOINT)
    .setProject(PROJECT_ID)
    .setKey(API_KEY);

  const databases = new Databases(adminClient);
  const storage = new Storage(adminClient);
  const teams = new Teams(adminClient);
  const users = new Users(adminClient);
  const functions = new Functions(adminClient);

  // Track synthetic resources for guaranteed teardown
  const cleanupQueue = {
    users: [],
    teams: [],
    documents: [],
    files: [],
  };

  try {
    // -------------------------------------------------------------------------
    // STEP 1: LIVE CLOUD CONNECTIVITY & SYNTHETIC IDENTITIES
    // -------------------------------------------------------------------------
    console.log('--- STEP 1: LIVE CLOUD CONNECTIVITY & SYNTHETIC IDENTITIES ---');

    // 1.1 Create synthetic patient user on Appwrite Cloud & generate session JWT
    const patientEmail = `synth_patient_${Date.now()}@example.com`;
    const patientUser = await users.create(ID.unique(), patientEmail, undefined, 'TestPassword123!', 'Synthetic Patient');
    cleanupQueue.users.push(patientUser.$id);
    const patientJwtObj = await users.createJWT(patientUser.$id);
    const patientJwt = patientJwtObj.jwt;
    assertTest('LIVE-01', 'Live patient user and session JWT created', Boolean(patientUser.$id && patientJwt), { userId: patientUser.$id });

    // 1.2 Create synthetic unprivileged attacker user & generate session JWT
    const attackerEmail = `synth_attacker_${Date.now()}@example.com`;
    const attackerUser = await users.create(ID.unique(), attackerEmail, undefined, 'TestPassword123!', 'Attacker User');
    cleanupQueue.users.push(attackerUser.$id);
    const attackerJwtObj = await users.createJWT(attackerUser.$id);
    const attackerJwt = attackerJwtObj.jwt;
    assertTest('LIVE-02', 'Live attacker user and session JWT created', Boolean(attackerUser.$id && attackerJwt), { userId: attackerUser.$id });

    // 1.3 Create synthetic Pharmacy Team A & Pharmacy User A (member of Team A)
    const pharmacyTeamA = await teams.create(ID.unique(), `Test Pharmacy Team Alpha ${Date.now()}`);
    cleanupQueue.teams.push(pharmacyTeamA.$id);
    const pharmacyUserAEmail = `synth_pharm_a_${Date.now()}@example.com`;
    const pharmacyUserA = await users.create(ID.unique(), pharmacyUserAEmail, undefined, 'TestPassword123!', 'Pharmacy Alpha Staff');
    cleanupQueue.users.push(pharmacyUserA.$id);
    await teams.createMembership(pharmacyTeamA.$id, ['member'], pharmacyUserA.email, pharmacyUserA.$id);
    const pharmacyJwtAObj = await users.createJWT(pharmacyUserA.$id);
    const pharmacyJwtA = pharmacyJwtAObj.jwt;
    assertTest('LIVE-03', 'Pharmacy Team Alpha and verified member user created with session JWT', Boolean(pharmacyTeamA.$id && pharmacyJwtA), { teamId: pharmacyTeamA.$id });

    // 1.4 Create synthetic Pharmacy Team B & Pharmacy User B (member of Team B)
    const pharmacyTeamB = await teams.create(ID.unique(), `Test Pharmacy Team Beta ${Date.now()}`);
    cleanupQueue.teams.push(pharmacyTeamB.$id);
    const pharmacyUserBEmail = `synth_pharm_b_${Date.now()}@example.com`;
    const pharmacyUserB = await users.create(ID.unique(), pharmacyUserBEmail, undefined, 'TestPassword123!', 'Pharmacy Beta Staff');
    cleanupQueue.users.push(pharmacyUserB.$id);
    await teams.createMembership(pharmacyTeamB.$id, ['member'], pharmacyUserB.email, pharmacyUserB.$id);
    const pharmacyJwtBObj = await users.createJWT(pharmacyUserB.$id);
    const pharmacyJwtB = pharmacyJwtBObj.jwt;
    assertTest('LIVE-04', 'Pharmacy Team Beta and verified member user created with session JWT', Boolean(pharmacyTeamB.$id && pharmacyJwtB), { teamId: pharmacyTeamB.$id });

    // 1.5 Create authoritative pharmacy documents in TEST_PHARM_COL
    const pharmacyDocAId = `pharm_alpha_${Date.now()}`;
    const pharmacyDocA = await databases.createDocument(
      TEST_DATABASE_ID,
      TEST_PHARM_COL,
      pharmacyDocAId,
      {
        name: 'Pharmacy Alpha Test',
        team_id: pharmacyTeamA.$id,
        is_active: true,
      },
      [Permission.read(Role.any())]
    );
    cleanupQueue.documents.push({ databaseId: TEST_DATABASE_ID, collectionId: TEST_PHARM_COL, documentId: pharmacyDocA.$id });

    const pharmacyDocBId = `pharm_beta_${Date.now()}`;
    const pharmacyDocB = await databases.createDocument(
      TEST_DATABASE_ID,
      TEST_PHARM_COL,
      pharmacyDocBId,
      {
        name: 'Pharmacy Beta Test',
        team_id: pharmacyTeamB.$id,
        is_active: true,
      },
      [Permission.read(Role.any())]
    );
    cleanupQueue.documents.push({ databaseId: TEST_DATABASE_ID, collectionId: TEST_PHARM_COL, documentId: pharmacyDocB.$id });
    assertTest('LIVE-05', 'Authoritative Pharmacy Alpha and Beta registered in database', Boolean(pharmacyDocA.$id && pharmacyDocB.$id));

    // -------------------------------------------------------------------------
    // STEP 2: PATIENT STORAGE UPLOAD FLOW & CRYPTOGRAPHIC TOKEN ENFORCEMENT
    // -------------------------------------------------------------------------
    console.log('\n--- STEP 2: PATIENT STORAGE UPLOAD FLOW & CRYPTOGRAPHIC TOKEN ENFORCEMENT ---');

    const liveEnv = {
      DATABASE_ID: TEST_DATABASE_ID,
      MANAGEMENT_TEAM_ID: TEST_MGMT_TEAM,
      PRESCRIPTIONS_COLLECTION_ID: TEST_RX_COL,
      ITEMS_COLLECTION_ID: TEST_ITEMS_COL,
      PHARMACIES_COLLECTION_ID: TEST_PHARM_COL,
      STORAGE_BUCKET_ID: TEST_BUCKET,
      APPWRITE_API_KEY: API_KEY,
      APPWRITE_FUNCTION_PROJECT_ID: PROJECT_ID,
      APPWRITE_FUNCTION_API_ENDPOINT: ENDPOINT,
    };

    const handler = createPrescriptionHandler({
      Client,
      Databases,
      Storage,
      Teams,
      Users,
      Account,
      ID,
      Query,
      Permission,
      Role,
      env: liveEnv,
      rejectProductionResources: true,
    });

    // 2.1 Patient 1 prepares upload reservation
    const prepUploadCtx = createExecutionContext({
      jwt: patientJwt,
      body: {
        action: 'prepare_upload',
        filename: 'synthetic_patient_rx.jpg',
        mime_type: 'image/jpeg',
      },
    });
    await handler(prepUploadCtx);
    const prepResult = prepUploadCtx.getResult();
    assertTest('LIVE-06', 'Patient 1 registers upload reservation via prepare_upload (HTTP 201)', prepResult.status === 201 && Boolean(prepResult.data?.file_id && prepResult.data?.upload_token));

    const patientFileId = prepResult.data.file_id;
    const patientUploadToken = prepResult.data.upload_token;
    cleanupQueue.documents.push({ databaseId: TEST_DATABASE_ID, collectionId: TEST_RX_COL, documentId: `upload_${patientFileId}` });

    // 2.2 Patient uploads synthetic file using PATIENT USER SESSION (not admin key)
    const patientClient = new Client()
      .setEndpoint(ENDPOINT)
      .setProject(PROJECT_ID)
      .setJWT(patientJwt);
    const patientStorage = new Storage(patientClient);

    const syntheticBuffer = Buffer.from('SYNTHETIC_PRESCRIPTION_IMAGE_FOR_INTEGRATION_TEST_' + Date.now(), 'utf-8');
    const syntheticFile = new File([syntheticBuffer], 'synthetic_patient_rx.jpg', { type: 'image/jpeg' });

    const uploadedStorageFile = await patientStorage.createFile(
      TEST_BUCKET,
      patientFileId,
      syntheticFile,
      [
        Permission.read(Role.user(patientUser.$id)),
        Permission.delete(Role.user(patientUser.$id)),
      ]
    );
    cleanupQueue.files.push({ bucketId: TEST_BUCKET, fileId: uploadedStorageFile.$id });
    assertTest('LIVE-07', 'File uploaded via PATIENT user session into storage bucket', uploadedStorageFile.$id === patientFileId);

    // 2.3 Creation without upload_token rejected with HTTP 400
    const missingTokenCtx = createExecutionContext({
      jwt: patientJwt,
      body: {
        action: 'create',
        image_id: patientFileId,
        items: [{ drug_name: 'Amoxicillin 500mg' }],
      },
    });
    await handler(missingTokenCtx);
    assertTest('LIVE-08', 'Creation with missing upload_token rejected with HTTP 400', missingTokenCtx.getResult().status === 400);

    // 2.4 Creation with forged/mismatched upload_token rejected with HTTP 403
    const mismatchedTokenCtx = createExecutionContext({
      jwt: patientJwt,
      body: {
        action: 'create',
        image_id: patientFileId,
        upload_token: 'forged_fake_token_123',
        items: [{ drug_name: 'Amoxicillin 500mg' }],
      },
    });
    await handler(mismatchedTokenCtx);
    assertTest('LIVE-09', 'Creation with mismatched upload_token rejected with HTTP 403', mismatchedTokenCtx.getResult().status === 403);

    // 2.5 Attacker attempts to hijack Patient 1 file with valid token -> rejected with HTTP 403 (wrong user)
    const attackerHijackCtx = createExecutionContext({
      jwt: attackerJwt,
      body: {
        action: 'create',
        image_id: patientFileId,
        upload_token: patientUploadToken,
        items: [{ drug_name: 'Hijacked Med' }],
      },
    });
    await handler(attackerHijackCtx);
    assertTest('LIVE-10', 'Attacker attempting to claim Patient 1 image rejected with HTTP 403 (User Isolation)', attackerHijackCtx.getResult().status === 403);

    // -------------------------------------------------------------------------
    // STEP 3: SUCCESSFUL CREATION & COMPLETE SERVICE OPERATIONS CONCURRENCY RACE
    // -------------------------------------------------------------------------
    console.log('\n--- STEP 3: CREATION & FULL SERVICE CONCURRENCY RACE ---');

    // 3.1 Patient 1 creates prescription with verified token
    const createCtx = createExecutionContext({
      jwt: patientJwt,
      body: {
        action: 'create',
        image_id: patientFileId,
        upload_token: patientUploadToken,
        items: [
          { drug_name: 'Amoxicillin 500mg', quantity: 21, dosage: 'TDS' },
          { drug_name: 'Ibuprofen 400mg', quantity: 14, dosage: 'PRN' },
        ],
      },
    });
    await handler(createCtx);
    const createRes = createCtx.getResult();
    assertTest('LIVE-11', 'Patient creates prescription with verified upload token (HTTP 201)', createRes.status === 201 && Boolean(createRes.data?.prescription?.$id));

    const prescriptionId = createRes.data.prescription.$id;
    cleanupQueue.documents.push({ databaseId: TEST_DATABASE_ID, collectionId: TEST_RX_COL, documentId: prescriptionId });
    cleanupQueue.documents.push({ databaseId: TEST_DATABASE_ID, collectionId: TEST_RX_COL, documentId: `claim_${patientFileId}` });

    // Track child items for cleanup
    const itemsList = await databases.listDocuments(TEST_DATABASE_ID, TEST_ITEMS_COL, [
      Query.equal('prescription_id', prescriptionId),
    ]);
    for (const item of itemsList.documents || []) {
      cleanupQueue.documents.push({ databaseId: TEST_DATABASE_ID, collectionId: TEST_ITEMS_COL, documentId: item.$id });
    }
    assertTest('LIVE-12', 'Prescription child items verified in database', itemsList.total === 2);

    // 3.2 Full Service Operations Concurrency Race: Two distinct worker instances competing for the same prescription
    // Uses INDEPENDENT handler instances with separate activeLocks sets to exercise authentic cross-worker DB coordination
    const worker1 = createPrescriptionHandler({
      Client, Databases, Storage, Teams, Users, Account, ID, Query, Permission, Role,
      env: liveEnv, rejectProductionResources: true,
    });
    const worker2 = createPrescriptionHandler({
      Client, Databases, Storage, Teams, Users, Account, ID, Query, Permission, Role,
      env: liveEnv, rejectProductionResources: true,
    });

    const raceCtx1 = createExecutionContext({
      jwt: patientJwt,
      body: { action: 'route', prescription_id: prescriptionId, pharmacy_id: pharmacyDocA.$id },
    });
    const raceCtx2 = createExecutionContext({
      jwt: patientJwt,
      body: { action: 'route', prescription_id: prescriptionId, pharmacy_id: pharmacyDocB.$id },
    });

    await Promise.all([worker1(raceCtx1), worker2(raceCtx2)]);

    const raceRes1 = raceCtx1.getResult();
    const raceRes2 = raceCtx2.getResult();
    const raceStatuses = [raceRes1.status, raceRes2.status].sort();
    const losingRes = raceRes1.status === 409 ? raceRes1 : raceRes2;
    assertTest(
      'LIVE-13',
      'Full service operation concurrency race between distinct workers: exactly 1 succeeds (200) and 1 rejected (409 Conflict)',
      raceStatuses[0] === 200 && raceStatuses[1] === 409 && !losingRes.data?.error?.includes('In-process operation already running'),
      { statuses: raceStatuses, losingError: losingRes.data?.error }
    );

    const winningRes = raceRes1.status === 200 ? raceRes1 : raceRes2;
    if (winningRes.data?.transitionId) {
      cleanupQueue.documents.push({ databaseId: TEST_DATABASE_ID, collectionId: TEST_RX_COL, documentId: winningRes.data.transitionId });
    }

    // -------------------------------------------------------------------------
    // STEP 4: ACTUAL PHARMACY-SESSION ACCESS BEFORE AND AFTER REASSIGNMENT
    // -------------------------------------------------------------------------
    console.log('\n--- STEP 4: REAL PHARMACY USER SESSION ACCESS & REVOCATION ---');

    // Ensure prescription is currently routed to Pharmacy Alpha
    const currentRx = await databases.getDocument(TEST_DATABASE_ID, TEST_RX_COL, prescriptionId);
    if (currentRx.pharmacy_id !== pharmacyDocA.$id) {
      // Re-route to Pharmacy Alpha to establish deterministic state
      const setupRouteCtx = createExecutionContext({
        jwt: patientJwt,
        body: { action: 'reassign', prescription_id: prescriptionId, new_pharmacy_id: pharmacyDocA.$id },
      });
      await handler(setupRouteCtx);
      if (setupRouteCtx.getResult().data?.transitionId) {
        cleanupQueue.documents.push({ databaseId: TEST_DATABASE_ID, collectionId: TEST_RX_COL, documentId: setupRouteCtx.getResult().data.transitionId });
      }
    }

    // Initialize user session databases clients for Pharmacy A and Pharmacy B
    const clientA = new Client().setEndpoint(ENDPOINT).setProject(PROJECT_ID).setJWT(pharmacyJwtA);
    const pharmacyDbA = new Databases(clientA);

    const clientB = new Client().setEndpoint(ENDPOINT).setProject(PROJECT_ID).setJWT(pharmacyJwtB);
    const pharmacyDbB = new Databases(clientB);

    // 4.1 Under Pharmacy Alpha routing:
    // Pharmacy User A session CAN read parent prescription
    let pharmACanReadParent = false;
    try {
      const docA = await pharmacyDbA.getDocument(TEST_DATABASE_ID, TEST_RX_COL, prescriptionId);
      pharmACanReadParent = Boolean(docA.$id === prescriptionId);
    } catch {
      pharmACanReadParent = false;
    }
    assertTest('LIVE-14A', 'Pharmacy User A session reads parent prescription when assigned', pharmACanReadParent);

    // Pharmacy User A session CAN read child items
    let pharmACanReadItems = false;
    try {
      const itemsA = await pharmacyDbA.listDocuments(TEST_DATABASE_ID, TEST_ITEMS_COL, [
        Query.equal('prescription_id', prescriptionId),
      ]);
      pharmACanReadItems = Boolean(itemsA.documents && itemsA.documents.length > 0);
    } catch {
      pharmACanReadItems = false;
    }
    assertTest('LIVE-14B', 'Pharmacy User A session reads child items when assigned', pharmACanReadItems);

    // Pharmacy User B session CANNOT read parent prescription (assert explicit 401/403/404 authorization rejection)
    let pharmBDeniedParent = false;
    let pharmBDeniedParentCode = null;
    try {
      await pharmacyDbB.getDocument(TEST_DATABASE_ID, TEST_RX_COL, prescriptionId);
    } catch (err) {
      pharmBDeniedParentCode = err.code;
      pharmBDeniedParent = Boolean(err.code === 404 || err.code === 403 || err.code === 401);
    }
    assertTest('LIVE-15A', 'Pharmacy User B session explicitly denied parent read (HTTP 401/403/404)', pharmBDeniedParent, { code: pharmBDeniedParentCode });

    // Pharmacy User B session CANNOT read child items (empty list or 401/403/404)
    let pharmBDeniedItems = false;
    try {
      const itemsB = await pharmacyDbB.listDocuments(TEST_DATABASE_ID, TEST_ITEMS_COL, [
        Query.equal('prescription_id', prescriptionId),
      ]);
      pharmBDeniedItems = Boolean(!itemsB.documents || itemsB.documents.length === 0);
    } catch (err) {
      pharmBDeniedItems = Boolean(err.code === 404 || err.code === 403 || err.code === 401);
    }
    assertTest('LIVE-15B', 'Pharmacy User B session denied child items when not assigned (0 items / 401/403/404)', pharmBDeniedItems);

    // 4.2 Reassign prescription to Pharmacy Beta
    const reassignCtx = createExecutionContext({
      jwt: patientJwt,
      body: { action: 'reassign', prescription_id: prescriptionId, new_pharmacy_id: pharmacyDocB.$id },
    });
    await handler(reassignCtx);
    const reassignRes = reassignCtx.getResult();
    assertTest('LIVE-16', 'Prescription successfully reassigned to Pharmacy Beta (HTTP 200)', reassignRes.status === 200);

    if (reassignRes.data?.transitionId) {
      cleanupQueue.documents.push({ databaseId: TEST_DATABASE_ID, collectionId: TEST_RX_COL, documentId: reassignRes.data.transitionId });
    }

    // 4.3 After reassignment to Pharmacy Beta:
    // Pharmacy User B session now CAN read parent prescription
    let pharmBCanReadParentAfter = false;
    try {
      const docB = await pharmacyDbB.getDocument(TEST_DATABASE_ID, TEST_RX_COL, prescriptionId);
      pharmBCanReadParentAfter = Boolean(docB.$id === prescriptionId);
    } catch {
      pharmBCanReadParentAfter = false;
    }
    assertTest('LIVE-17A', 'Pharmacy User B session reads parent prescription after reassignment', pharmBCanReadParentAfter);

    // Pharmacy User B session now CAN read child items
    let pharmBCanReadItemsAfter = false;
    try {
      const itemsB = await pharmacyDbB.listDocuments(TEST_DATABASE_ID, TEST_ITEMS_COL, [
        Query.equal('prescription_id', prescriptionId),
      ]);
      pharmBCanReadItemsAfter = Boolean(itemsB.documents && itemsB.documents.length > 0);
    } catch {
      pharmBCanReadItemsAfter = false;
    }
    assertTest('LIVE-17B', 'Pharmacy User B session reads child items after reassignment', pharmBCanReadItemsAfter);

    // Pharmacy User A session access is completely REVOKED on parent prescription (explicit 401/403/404)
    let pharmADeniedParentAfter = false;
    let pharmADeniedParentCode = null;
    try {
      await pharmacyDbA.getDocument(TEST_DATABASE_ID, TEST_RX_COL, prescriptionId);
    } catch (err) {
      pharmADeniedParentCode = err.code;
      pharmADeniedParentAfter = Boolean(err.code === 404 || err.code === 403 || err.code === 401);
    }
    assertTest('LIVE-18A', 'Pharmacy User A session access REVOKED on parent prescription (HTTP 401/403/404)', pharmADeniedParentAfter, { code: pharmADeniedParentCode });

    // Pharmacy User A session access is completely REVOKED on child items
    let pharmADeniedItemsAfter = false;
    try {
      const itemsA = await pharmacyDbA.listDocuments(TEST_DATABASE_ID, TEST_ITEMS_COL, [
        Query.equal('prescription_id', prescriptionId),
      ]);
      pharmADeniedItemsAfter = Boolean(!itemsA.documents || itemsA.documents.length === 0);
    } catch (err) {
      pharmADeniedItemsAfter = Boolean(err.code === 404 || err.code === 403 || err.code === 401);
    }
    assertTest('LIVE-18B', 'Pharmacy User A session access REVOKED on child items (0 items / 401/403/404)', pharmADeniedItemsAfter);

    // -------------------------------------------------------------------------
    // STEP 5: OVERLAPPING ROLLBACK / RECOVERY CONCURRENCY CHECK
    // -------------------------------------------------------------------------
    console.log('\n--- STEP 5: OVERLAPPING ROLLBACK / RECOVERY CONCURRENCY CHECK ---');

    // Simulate in-flight recovery transition on a test prescription
    const recRxId = `rx_rec_${Date.now()}`;
    const recTxDocId = `tx_${recRxId}_v2`;
    cleanupQueue.documents.push({ databaseId: TEST_DATABASE_ID, collectionId: TEST_RX_COL, documentId: recRxId });
    cleanupQueue.documents.push({ databaseId: TEST_DATABASE_ID, collectionId: TEST_RX_COL, documentId: recTxDocId });

    await databases.createDocument(
      TEST_DATABASE_ID,
      TEST_RX_COL,
      recTxDocId,
      {
        user_id: patientUser.$id,
        status: 'transition_recovering',
        image_id: recRxId,
        parse_source: 'state_transition',
        confidence_score: 1.0,
        ai_parsed_json: JSON.stringify({ prescription_id: recRxId, from_version: 1, to_version: 2 }),
      },
      [Permission.read(Role.user(patientUser.$id))]
    );

    await databases.createDocument(
      TEST_DATABASE_ID,
      TEST_RX_COL,
      recRxId,
      {
        user_id: patientUser.$id,
        status: 'routed',
        image_id: 'img_test_rec',
        parse_source: 'gateway_v1',
        confidence_score: 1.0,
        ai_parsed_json: JSON.stringify({ version: 1, active_tx: recTxDocId }),
      },
      [Permission.read(Role.user(patientUser.$id))]
    );

    // Use an independent worker instance to verify that DB state blocks cross-worker operations
    const recoveryWorker = createPrescriptionHandler({
      Client, Databases, Storage, Teams, Users, Account, ID, Query, Permission, Role,
      env: liveEnv, rejectProductionResources: true,
    });

    const overlapCtx = createExecutionContext({
      jwt: patientJwt,
      body: { action: 'reassign', prescription_id: recRxId, new_pharmacy_id: pharmacyDocB.$id },
    });
    await recoveryWorker(overlapCtx);
    const overlapRes = overlapCtx.getResult();
    assertTest(
      'LIVE-19',
      'Concurrent operation rejected with HTTP 409 while transition is in transition_recovering',
      overlapRes.status === 409 && overlapRes.data?.error?.includes('transition_recovering')
    );

    // -------------------------------------------------------------------------
    // STEP 6: DEPLOYED FUNCTION WIRE EXECUTION HOOK (OPTIONAL)
    // -------------------------------------------------------------------------
    console.log('\n--- STEP 6: DEPLOYED FUNCTION WIRE EXECUTION HOOK ---');

    if (DEPLOYED_FUNCTION_ID && DEPLOYED_FUNCTION_ID.trim()) {
      console.log(`[INFO] Testing deployed function ID: ${DEPLOYED_FUNCTION_ID}`);
      try {
        const execution = await functions.createExecution(
          DEPLOYED_FUNCTION_ID,
          JSON.stringify({ action: 'create', items: [] }),
          false,
          '/',
          'POST',
          {
            'x-appwrite-user-jwt': patientJwt,
            'content-type': 'application/json',
          }
        );
        assertTest(
          'LIVE-20',
          'Deployed Appwrite function executed over the wire',
          execution.status === 'completed' && execution.responseStatusCode === 400,
          { statusCode: execution.responseStatusCode, status: execution.status }
        );
      } catch (execErr) {
        assertTest('LIVE-20', 'Deployed Appwrite function execution over the wire', false, { error: execErr.message });
      }
    } else {
      console.log('[INFO] APPWRITE_FUNCTION_ID not provided in environment.');
      console.log('       Service was thoroughly validated with live Appwrite Cloud clients and patient/pharmacy sessions.');
    }

  } catch (liveErr) {
    console.error('FATAL ERROR DURING LIVE INTEGRATION TEST:', liveErr);
    failedAssertions++;
  } finally {
    // -------------------------------------------------------------------------
    // STEP 7: GUARANTEED LIVE TEARDOWN WITH ZERO-TOLERANCE ERROR ASSERTION
    // -------------------------------------------------------------------------
    console.log('\n--- STEP 7: TEARDOWN & SYNTHETIC ARTIFACT PURGE ---');
    const cleanupErrors = [];

    // Delete synthetic files from test storage bucket
    for (const file of cleanupQueue.files) {
      try {
        await storage.deleteFile(file.bucketId, file.fileId);
      } catch (err) {
        if (err.code !== 404 && !err.message?.includes('not found')) {
          cleanupErrors.push(`Storage file ${file.fileId}: ${err.message}`);
        }
      }
    }

    // Delete synthetic documents from test database
    for (const doc of cleanupQueue.documents) {
      try {
        await databases.deleteDocument(doc.databaseId, doc.collectionId, doc.documentId);
      } catch (err) {
        if (err.code !== 404 && !err.message?.includes('not found')) {
          cleanupErrors.push(`Document ${doc.documentId}: ${err.message}`);
        }
      }
    }

    // Delete synthetic pharmacy teams
    for (const teamId of cleanupQueue.teams) {
      try {
        await teams.delete(teamId);
      } catch (err) {
        if (err.code !== 404 && !err.message?.includes('not found')) {
          cleanupErrors.push(`Team ${teamId}: ${err.message}`);
        }
      }
    }

    // Delete synthetic test users
    for (const userId of cleanupQueue.users) {
      try {
        await users.delete(userId);
      } catch (err) {
        if (err.code !== 404 && !err.message?.includes('not found')) {
          cleanupErrors.push(`User ${userId}: ${err.message}`);
        }
      }
    }

    assertTest(
      'LIVE-CLEANUP',
      'Teardown purged all synthetic Cloud documents, storage files, teams, and user accounts without error',
      cleanupErrors.length === 0,
      { cleanupErrors }
    );
  }

  console.log('\n========================================================================');
  console.log(`LIVE INTEGRATION SUITE SUMMARY: ${passedAssertions} PASSED, ${failedAssertions} FAILED`);
  console.log('========================================================================');

  if (failedAssertions > 0) {
    process.exit(1);
  }
}

runLiveIntegrationSuite();
