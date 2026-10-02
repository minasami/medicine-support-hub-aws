import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createOcrHandler } from "../src/main.js";

const ORIGINAL_IMAGE = Buffer.from("synthetic-prescription-image-fixture", "utf8");
const PROCESSED_IMAGE = Buffer.from("synthetic-preprocessed-image-fixture", "utf8");
const OWNER = "patient_alice";
const OWNER_PERMISSIONS = [
  `read("user:${OWNER}")`,
  `delete("user:${OWNER}")`,
];
const BASE_ENV = {
  APPWRITE_FUNCTION_API_ENDPOINT: "https://fra.cloud.appwrite.io/v1",
  APPWRITE_FUNCTION_PROJECT_ID: "synthetic-test-project",
  APPWRITE_API_KEY: "synthetic-server-api-key",
  APPWRITE_DATABASE_ID: "synthetic-test-database",
  APPWRITE_RX_BUCKET: "synthetic-test-bucket",
};

function createHarness({
  env = {},
  callerId = OWNER,
  jwt = "synthetic-user-jwt",
  permissions = OWNER_PERMISSIONS,
  fileBytes = ORIGINAL_IMAGE,
  mimeType = "image/jpeg",
  sizeOriginal = fileBytes.length,
  fetchResponse,
} = {}) {
  const state = {
    storageMetadataReads: 0,
    storageDownloads: 0,
    fetchCalls: [],
    documents: [],
  };
  const file = {
    $id: "synthetic-image-id",
    bucketId: BASE_ENV.APPWRITE_RX_BUCKET,
    name: "synthetic.jpg",
    mimeType,
    sizeOriginal,
    $permissions: [...permissions],
  };

  class MockClient {
    setEndpoint(value) { this.endpoint = value; return this; }
    setProject(value) { this.project = value; return this; }
    setJWT(value) { this.jwt = value; return this; }
    setKey(value) { this.key = value; return this; }
  }
  class MockAccount {
    constructor(client) { this.client = client; }
    async get() {
      if (!this.client.jwt || this.client.jwt !== jwt) throw new Error("invalid JWT");
      return { $id: callerId };
    }
  }
  class MockStorage {
    async getFile(bucketId, fileId) {
      state.storageMetadataReads += 1;
      if (bucketId !== file.bucketId || fileId !== file.$id) throw new Error("not found");
      return structuredClone(file);
    }
    async getFileDownload(bucketId, fileId) {
      state.storageDownloads += 1;
      if (bucketId !== file.bucketId || fileId !== file.$id) throw new Error("not found");
      return Buffer.from(fileBytes);
    }
  }
  class MockDatabases {
    async createDocument(databaseId, collectionId, documentId, data) {
      const created = { databaseId, collectionId, documentId, ...structuredClone(data) };
      state.documents.push(created);
      return { $id: documentId };
    }
    async listDocuments() { return { total: 0, documents: [] }; }
  }
  const MockQuery = {
    greaterThan: (attribute, value) => ({ method: "greaterThan", attribute, value }),
    equal: (attribute, value) => ({ method: "equal", attribute, value }),
    orderDesc: (attribute) => ({ method: "orderDesc", attribute }),
    limit: (value) => ({ method: "limit", value }),
  };
  let id = 0;
  const MockID = { unique: () => `synthetic-document-${++id}` };
  const workerFetch = async (url, options) => {
    state.fetchCalls.push({ url, options });
    if (fetchResponse instanceof Error) throw fetchResponse;
    return fetchResponse || {
      ok: true,
      async json() {
        return {
          ok: true,
          mime_type: "image/jpeg",
          preprocessed_image_base64: PROCESSED_IMAGE.toString("base64"),
          analysis: { document: { detected: true }, quality: { warnings: [] } },
        };
      },
    };
  };
  const handler = createOcrHandler({
    Client: MockClient,
    Account: MockAccount,
    Storage: MockStorage,
    Databases: MockDatabases,
    Query: MockQuery,
    ID: MockID,
    env: { ...BASE_ENV, ...env },
    fetch: workerFetch,
    now: () => new Date("2026-01-02T03:04:05.000Z"),
  });

  async function execute(body, requestJwt = jwt) {
    let status = 200;
    let data;
    const ctx = {
      req: {
        method: "POST",
        body,
        headers: requestJwt ? { "x-appwrite-user-jwt": requestJwt } : {},
      },
      res: {
        json(value, code = 200) {
          data = value;
          status = code;
          return { status, data };
        },
      },
      log() {},
      error() {},
    };
    await handler(ctx);
    return { status, data };
  }

  return { execute, state, file };
}

describe("authenticated OpenCV prescription bridge", () => {
  it("rejects requests without the Appwrite user JWT before touching storage or AWS", async () => {
    const harness = createHarness({ env: { OPENCV5_PRESCRIPTION_VISION_ENABLED: "true" } });
    const result = await harness.execute({ action: "preprocess", imageId: "synthetic-image-id" }, null);
    assert.equal(result.status, 401);
    assert.equal(harness.state.storageMetadataReads, 0);
    assert.equal(harness.state.fetchCalls.length, 0);
  });

  it("rejects an invalid or expired JWT before touching storage or AWS", async () => {
    const harness = createHarness({ env: { OPENCV5_PRESCRIPTION_VISION_ENABLED: "true" } });
    const result = await harness.execute({ action: "preprocess", imageId: "synthetic-image-id" }, "forged-jwt");
    assert.equal(result.status, 401);
    assert.equal(harness.state.storageMetadataReads, 0);
    assert.equal(harness.state.fetchCalls.length, 0);
  });

  it("keeps preprocessing off by default and does not download or send the image", async () => {
    const harness = createHarness();
    const result = await harness.execute({ action: "preprocess", imageId: "synthetic-image-id" });
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.preprocessing, { enabled: false, applied: false });
    assert.equal(harness.state.storageMetadataReads, 1);
    assert.equal(harness.state.storageDownloads, 0);
    assert.equal(harness.state.fetchCalls.length, 0);
  });

  it("rejects another user's file even if the request forges user_id and pharmacist_id", async () => {
    const harness = createHarness({
      permissions: ['read("user:patient_bob")', 'delete("user:patient_bob")'],
      env: { OPENCV5_PRESCRIPTION_VISION_ENABLED: "true" },
    });
    const result = await harness.execute({
      action: "preprocess",
      imageId: "synthetic-image-id",
      user_id: "patient_bob",
      pharmacist_id: "patient_bob",
    });
    assert.equal(result.status, 403);
    assert.equal(harness.state.storageDownloads, 0);
    assert.equal(harness.state.fetchCalls.length, 0);
  });

  it("requires both the caller's read and delete ACLs before processing", async () => {
    const harness = createHarness({
      permissions: [`read("user:${OWNER}")`, `update("user:${OWNER}")`],
      env: { OPENCV5_PRESCRIPTION_VISION_ENABLED: "true" },
    });
    const result = await harness.execute({ action: "preprocess", imageId: "synthetic-image-id" });
    assert.equal(result.status, 403);
    assert.equal(harness.state.fetchCalls.length, 0);
  });

  it("does not download or send an oversized uploaded image", async () => {
    const harness = createHarness({
      sizeOriginal: 4 * 1024 * 1024 + 1,
      env: { OPENCV5_PRESCRIPTION_VISION_ENABLED: "true" },
    });
    const result = await harness.execute({ action: "preprocess", imageId: "synthetic-image-id" });
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.preprocessing, { enabled: true, applied: false, fallback: "original" });
    assert.equal(harness.state.storageDownloads, 0);
    assert.equal(harness.state.fetchCalls.length, 0);
  });

  it("signs the server-to-server Lambda Function URL call with SigV4 and sends only image bytes", async () => {
    const harness = createHarness({
      env: {
        OPENCV5_PRESCRIPTION_VISION_ENABLED: "true",
        OPENCV5_WORKER_URL: "https://abc123.lambda-url.eu-central-1.on.aws/",
        AWS_REGION: "eu-central-1",
        AWS_ACCESS_KEY_ID: "SYNTHETIC_ACCESS_KEY",
        AWS_SECRET_ACCESS_KEY: "synthetic_secret_key",
        AWS_SESSION_TOKEN: "synthetic_session_token",
      },
    });
    const result = await harness.execute({ action: "preprocess", imageId: "synthetic-image-id" });
    assert.equal(result.status, 200);
    assert.equal(result.data.preprocessing.applied, true);
    assert.equal(result.data.preprocessing.mime_type, "image/jpeg");
    assert.equal(result.data.preprocessing.preprocessed_image_base64, PROCESSED_IMAGE.toString("base64"));
    assert.equal(harness.state.storageDownloads, 1);
    assert.equal(harness.state.fetchCalls.length, 1);

    const [{ url, options }] = harness.state.fetchCalls;
    assert.equal(url, "https://abc123.lambda-url.eu-central-1.on.aws/");
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.match(options.headers.authorization, /^AWS4-HMAC-SHA256 Credential=SYNTHETIC_ACCESS_KEY\/20260102\/eu-central-1\/lambda\/aws4_request,/);
    assert.match(options.headers.authorization, /SignedHeaders=.*host/);
    assert.ok(options.headers["x-amz-security-token"]);
    const requestBody = JSON.parse(options.body);
    assert.equal(requestBody.image_base64, ORIGINAL_IMAGE.toString("base64"));
    assert.deepEqual(Object.keys(requestBody), ["image_base64"]);
    assert.doesNotMatch(JSON.stringify(result.data), /SYNTHETIC_ACCESS_KEY|synthetic_secret_key|synthetic_session_token/);
  });

  it("uses the authenticated Appwrite account, not caller-supplied identity fields, for prescription ownership", async () => {
    const harness = createHarness();
    const result = await harness.execute({
      imageId: "synthetic-image-id",
      user_id: "patient_bob",
      userId: "patient_bob",
      pharmacist_id: "pharmacist_attacker",
      text: "Metformin 500mg twice daily",
    });
    assert.equal(result.status, 200);
    const prescription = harness.state.documents.find((document) => document.collectionId === "prescriptions");
    assert.ok(prescription);
    assert.equal(prescription.user_id, OWNER);
    assert.equal(result.data.assigned_pharmacists.includes("pharmacist_attacker"), false);
    assert.equal(harness.state.fetchCalls.length, 0);
  });

  it("falls back to the original upload when the worker is unavailable", async () => {
    const harness = createHarness({
      env: {
        OPENCV5_PRESCRIPTION_VISION_ENABLED: "true",
        OPENCV5_WORKER_URL: "https://abc123.lambda-url.eu-central-1.on.aws/",
        AWS_REGION: "eu-central-1",
        AWS_ACCESS_KEY_ID: "SYNTHETIC_ACCESS_KEY",
        AWS_SECRET_ACCESS_KEY: "synthetic_secret_key",
      },
      fetchResponse: { ok: false, async json() { throw new Error("unexpected body"); } },
    });
    const result = await harness.execute({ action: "preprocess", imageId: "synthetic-image-id" });
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.preprocessing, { enabled: true, applied: false, fallback: "original" });
    assert.equal(harness.state.fetchCalls.length, 1);
  });

  it("does not issue a worker request when server-side SigV4 configuration is incomplete", async () => {
    const harness = createHarness({
      env: {
        OPENCV5_PRESCRIPTION_VISION_ENABLED: "true",
        OPENCV5_WORKER_URL: "https://abc123.lambda-url.eu-central-1.on.aws/",
        AWS_REGION: "eu-central-1",
      },
    });
    const result = await harness.execute({ action: "preprocess", imageId: "synthetic-image-id" });
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.preprocessing, { enabled: true, applied: false, fallback: "original" });
    assert.equal(harness.state.storageDownloads, 1);
    assert.equal(harness.state.fetchCalls.length, 0);
  });

  it("rejects non-Lambda Function URL hosts without making a network request", async () => {
    const harness = createHarness({
      env: {
        OPENCV5_PRESCRIPTION_VISION_ENABLED: "true",
        OPENCV5_WORKER_URL: "https://example.com/",
        AWS_REGION: "eu-central-1",
        AWS_ACCESS_KEY_ID: "SYNTHETIC_ACCESS_KEY",
        AWS_SECRET_ACCESS_KEY: "synthetic_secret_key",
      },
    });
    const result = await harness.execute({ action: "preprocess", imageId: "synthetic-image-id" });
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.preprocessing, { enabled: true, applied: false, fallback: "original" });
    assert.equal(harness.state.fetchCalls.length, 0);
  });
});
