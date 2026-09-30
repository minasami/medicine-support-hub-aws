/**
 * AWS Lambda + Function URL for Medicine Support Hub.
 * - GET  /health                      — Health and AWS services manifest
 * - GET  /api/prescriptions           — List prescriptions from DynamoDB
 * - POST /api/prescriptions           — Store prescription record to DynamoDB
 * - POST /api/prescriptions/upload-url — Generate S3 presigned upload URL
 * - POST /api/clinical/analyze        — Bedrock AI Clinical Assistant & EDA safety analysis
 * - POST /mcp                         — Bearer / static token, MCP tools for Agent Toolkit
 */
import { isAllowedBearer } from "./oauth.js";
import { callTool, handleRpc, isRpc, TOOLS } from "./mcp-rpc.js";
import { speakWithBedrock, awsEnabled } from "./bedrock.js";
import {
  listPrescriptions,
  createPrescription,
  createPresignedUploadUrl,
  analyzeClinicalData,
} from "./aws-services.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
};

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

function methodOf(event) {
  return (
    event.requestContext?.http?.method ||
    event.httpMethod ||
    event.requestContext?.httpMethod ||
    "GET"
  ).toUpperCase();
}

function pathOf(event) {
  const raw = event.rawPath || event.path || "/";
  return String(raw).replace(/\/$/, "") || "/";
}

function header(event, name) {
  const headers = event.headers || {};
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === want) return Array.isArray(v) ? v[0] : v;
  }
  return "";
}

function readBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return { __parseError: true };
  }
}

async function attachBedrockSpeech(rpc) {
  const result = rpc && rpc.result;
  if (!result || !result.structuredContent) return;
  const row = result.structuredContent.row;
  if (!row) return;
  const fallback = result.structuredContent.speech || result.content?.[0]?.text;
  const next = await speakWithBedrock(row, fallback);
  result.structuredContent.speech = next;
  result.structuredContent.aws = { bedrock: awsEnabled(), runtime: "lambda" };
  if (result.content && result.content[0]) result.content[0].text = next;
}

export async function handler(event = {}) {
  const method = methodOf(event);
  const path = pathOf(event);

  if (method === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  // 1. Health check & AWS System Status
  const isHealth =
    method === "GET" &&
    (path === "/health" || path === "/" || path.endsWith("/health"));
  if (isHealth) {
    return reply(200, {
      ok: true,
      service: "msh-status",
      runtime: "aws-lambda",
      version: "2.0.0-aws-hackathon",
      region: process.env.AWS_REGION || "us-east-1",
      aws: {
        amplify: {
          appId: "d24cynqfuktylf",
          url: "https://main.d24cynqfuktylf.amplifyapp.com",
          status: "LIVE",
        },
        s3: {
          bucket: process.env.S3_BUCKET || "msh-prescriptions-243894880675",
          status: "CONNECTED",
        },
        dynamodb: {
          table: process.env.DYNAMODB_TABLE || "msh_prescriptions",
          status: "ACTIVE",
        },
        bedrock: {
          enabled: true,
          model: process.env.BEDROCK_MODEL_ID || "us.amazon.nova-2-lite-v1:0",
          hybridFallback: "ACTIVE",
        },
      },
      tools: TOOLS.map((t) => t.name),
    });
  }

  // 2. DynamoDB: List Prescriptions
  if (method === "GET" && (path === "/api/prescriptions" || path === "/prescriptions")) {
    const list = await listPrescriptions();
    return reply(200, { ok: true, prescriptions: list });
  }

  // 3. DynamoDB: Create Prescription
  if (method === "POST" && (path === "/api/prescriptions" || path === "/prescriptions")) {
    const payload = readBody(event);
    if (payload.__parseError) return reply(400, { error: "bad_json" });
    const created = await createPrescription(payload);
    return reply(201, { ok: true, prescription: created });
  }

  // 4. S3: Generate Presigned Upload URL
  if (
    method === "POST" &&
    (path === "/api/prescriptions/upload-url" || path === "/upload-url")
  ) {
    const payload = readBody(event);
    const presigned = await createPresignedUploadUrl(
      payload.filename,
      payload.contentType,
    );
    return reply(200, { ok: true, ...presigned });
  }

  // 5. Bedrock + EDA Clinical Assistant
  if (
    method === "POST" &&
    (path === "/api/clinical/analyze" || path === "/clinical/analyze")
  ) {
    const payload = readBody(event);
    if (payload.__parseError) return reply(400, { error: "bad_json" });
    const analysis = await analyzeClinicalData(payload);
    return reply(200, { ok: true, analysis });
  }

  // 6. MCP Protocol Handler for Agent Toolkit
  const mcp =
    method === "POST" &&
    (path === "/mcp" || path.endsWith("/mcp"));
  if (mcp) {
    const auth = isAllowedBearer(header(event, "authorization"));
    if (!auth) return reply(401, { error: "unauthorized" });
    const ctx = { sub: auth.sub || "mina" };

    const payload = readBody(event);
    if (payload.__parseError) return reply(400, { error: "bad_json" });

    if (isRpc(payload)) {
      const out = handleRpc(payload, ctx);
      if (out == null) return { statusCode: 202, headers: CORS, body: "" };
      await attachBedrockSpeech(out);
      return reply(200, out);
    }

    const name = payload.name || payload.tool;
    const args = payload.arguments || payload.args || {};
    if (!name) return reply(400, { error: "missing_tool" });
    const simple = callTool(name, args, ctx);
    await attachBedrockSpeech({ result: simple });
    return reply(200, simple.structuredContent || simple);
  }

  return reply(404, { error: "not_found", path, method });
}
