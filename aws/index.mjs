// Leaderboard Lambda for "Spot the Rejection".
// Runtime: nodejs20.x (AWS SDK v3 is preinstalled — no npm install needed).
//
// Routes (wired in template.yaml):
//   GET  /scores  -> { scores: [ { name, timeMs }, ... ] }  (fastest first, top 10)
//   POST /scores  -> body { name, timeMs }  ->  { ok: true }
//
// Data model (single partition so we can sort all runs by time):
//   pk = "LB" (constant), timeMs (Number, sort key), name (String), ts, expiresAt

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME;
const ORIGIN = process.env.ALLOW_ORIGIN || "*";
const PK = "LB";
const TOP_N = 10;

const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Content-Type": "application/json",
};

function reply(statusCode, body) {
  return { statusCode, headers: cors, body: JSON.stringify(body) };
}

export const handler = async (event) => {
  const method =
    event?.requestContext?.http?.method || event?.httpMethod || "GET";

  // CORS preflight (usually handled by API Gateway, but be safe)
  if (method === "OPTIONS") return reply(200, { ok: true });

  try {
    if (method === "GET") return await getScores();
    if (method === "POST") return await postScore(event);
    return reply(405, { error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return reply(500, { error: "Server error" });
  }
};

async function getScores() {
  // Query the single partition, sorted ascending by timeMs (fastest first).
  const out = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": PK },
      ScanIndexForward: true, // ascending: smallest time first
      Limit: TOP_N,
    })
  );
  const scores = (out.Items || []).map((it) => ({
    name: it.name,
    timeMs: it.timeMs,
  }));
  return reply(200, { scores });
}

async function postScore(event) {
  let data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch {
    return reply(400, { error: "Invalid JSON" });
  }

  // --- validation ---
  let name = typeof data.name === "string" ? data.name.trim().slice(0, 16) : "";
  if (!name) name = "Anonymous";
  // strip control chars / angle brackets to avoid junk in the list
  name = name.replace(/[<>\u0000-\u001F]/g, "");

  const timeMs = Number(data.timeMs);
  if (!Number.isFinite(timeMs) || timeMs <= 0 || timeMs > 60 * 60 * 1000) {
    return reply(400, { error: "Invalid timeMs" });
  }

  const now = Date.now();
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: PK,
        timeMs: Math.round(timeMs),
        name,
        ts: now,
        // auto-expire after 30 days (TTL attribute is in seconds)
        expiresAt: Math.floor(now / 1000) + 30 * 24 * 60 * 60,
      },
    })
  );

  return reply(200, { ok: true });
}
