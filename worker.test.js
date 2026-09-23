// Regression tests for worker.js's fetch handler -- the actual Worker
// entry point, as opposed to worker-lib.test.js which covers its pure
// helpers in isolation. Same synthetic-RS256-keypair pattern as
// worker-lib.test.js: no wrangler, no real Cloudflare account, no network
// beyond a mocked global.fetch (JWKS + Anthropic only). Run with:
// node --test worker.test.js
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.js";
import { _resetJWKSCache } from "./worker-lib.js";

const TEAM_DOMAIN = "supreme-test.cloudflareaccess.com";
const AUD = "test-application-audience-tag";
const KID = "test-key-1";

function toBase64url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function jsonToBase64url(obj) {
  return toBase64url(new TextEncoder().encode(JSON.stringify(obj)));
}

let keyPair, jwk;

before(async () => {
  keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
  jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  jwk.kid = KID;
  jwk.use = "sig";
  jwk.key_ops = ["verify"];

  // Mock global fetch for exactly the two upstreams worker.js can reach:
  // the Access JWKS endpoint, and (only for the vision proxy) Anthropic.
  // Anything else is a bug -- fail loudly instead of silently succeeding.
  global.fetch = async (url, init) => {
    const href = String(url);
    if (href === `https://${TEAM_DOMAIN}/cdn-cgi/access/certs`) {
      return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
    }
    if (href === "https://api.anthropic.com/v1/messages") {
      return new Response(JSON.stringify({ mock: "anthropic-response", sawApiKey: init?.headers?.["x-api-key"] || null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error("Unexpected fetch in test: " + href);
  };
});

beforeEach(() => {
  _resetJWKSCache();
});

after(() => {
  delete global.fetch;
});

async function makeToken({ overridePayload = {} } = {}) {
  const header = { alg: "RS256", kid: KID, typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    email: "admin@supreme.example",
    iss: `https://${TEAM_DOMAIN}`,
    aud: AUD,
    exp: now + 3600,
    nbf: now - 60,
    ...overridePayload,
  };
  const headerB64 = jsonToBase64url(header);
  const payloadB64 = jsonToBase64url(payload);
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const sigBuf = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, keyPair.privateKey, signingInput);
  const sigB64 = toBase64url(new Uint8Array(sigBuf));
  return `${headerB64}.${payloadB64}.${sigB64}`;
}

function baseEnv(overrides = {}) {
  return {
    CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    CF_ACCESS_AUD: AUD,
    ACCESS_ROLES_JSON: JSON.stringify({
      "admin@supreme.example": "admin",
      "luis@supreme.example": "tecnico",
    }),
    ACCESS_TECH_NAMES_JSON: JSON.stringify({ "luis@supreme.example": "Luis" }),
    ...overrides,
  };
}

function withAuthHeader(headers, token) {
  return { ...headers, "Cf-Access-Jwt-Assertion": token };
}

// ---------------------------------------------------------------------
// 1. favicon
// ---------------------------------------------------------------------

test("worker: GET /favicon.ico returns 204 with a null body, bypassing auth entirely (no env needed)", async () => {
  const request = new Request("https://example.com/favicon.ico");
  const res = await worker.fetch(request, {});
  assert.equal(res.status, 204);
  assert.equal(res.body, null);
});

// ---------------------------------------------------------------------
// 2. autenticacion faltante
// ---------------------------------------------------------------------

test("worker: missing Cf-Access-Jwt-Assertion header -> 401, never reaches routing/backends", async () => {
  const request = new Request("https://example.com/api/edits");
  const res = await worker.fetch(request, baseEnv());
  assert.equal(res.status, 401);
});

// ---------------------------------------------------------------------
// 3. configuracion faltante
// ---------------------------------------------------------------------

test("worker: JWT present but CF_ACCESS_TEAM_DOMAIN/AUD unset -> 500, fails closed instead of skipping auth", async () => {
  const request = new Request("https://example.com/api/edits", {
    headers: { "Cf-Access-Jwt-Assertion": "irrelevant-because-config-is-checked-first" },
  });
  const res = await worker.fetch(request, { ACCESS_ROLES_JSON: "{}" });
  assert.equal(res.status, 500);
});

// ---------------------------------------------------------------------
// 4-5. cache de HTML y binarios
// ---------------------------------------------------------------------

test("worker: serving an HTML asset strips caching headers and forces no-store", async () => {
  const token = await makeToken();
  const request = new Request("https://example.com/index.html", {
    headers: withAuthHeader({}, token),
  });
  const env = baseEnv({
    ASSETS: {
      async fetch() {
        return new Response("<html></html>", {
          status: 200,
          headers: { "Content-Type": "text/html", ETag: '"abc123"', "Last-Modified": "Wed, 16 Sep 2026 00:00:00 GMT" },
        });
      },
    },
  });
  const res = await worker.fetch(request, env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "no-cache, no-store, must-revalidate");
  assert.equal(res.headers.get("Pragma"), "no-cache");
  assert.equal(res.headers.get("ETag"), null);
  assert.equal(res.headers.get("Last-Modified"), null);
});

test("worker: serving a binary/static asset (non-HTML) passes the response through untouched", async () => {
  const token = await makeToken();
  const request = new Request("https://example.com/logo.png", {
    headers: withAuthHeader({}, token),
  });
  const env = baseEnv({
    ASSETS: {
      async fetch() {
        return new Response("binary-bytes", {
          status: 200,
          headers: { "Content-Type": "image/png", ETag: '"logo-etag"', "Cache-Control": "public, max-age=31536000, immutable" },
        });
      },
    },
  });
  const res = await worker.fetch(request, env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("ETag"), '"logo-etag"');
  assert.equal(res.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
});

// ---------------------------------------------------------------------
// 6-7. GET/POST /api/edits para admin
// ---------------------------------------------------------------------

test("worker: admin GET /api/edits proxies to SUPREMEKV unfiltered", async () => {
  const token = await makeToken({ overridePayload: { email: "admin@supreme.example" } });
  let sawRequest = null;
  const env = baseEnv({
    SUPREMEKV: {
      async fetch(req) {
        sawRequest = req;
        return new Response(JSON.stringify({ edits: {}, deleted: [], newInvs: [{ wo: "1" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  });
  const request = new Request("https://example.com/api/edits", { headers: withAuthHeader({}, token) });
  const res = await worker.fetch(request, env);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.newInvs.length, 1);
  assert.equal(new URL(sawRequest.url).pathname, "/edits");
  assert.equal(sawRequest.headers.get("X-Verified-Role"), "admin");
});

test("worker: admin POST /api/edits proxies the write through to SUPREMEKV", async () => {
  const token = await makeToken({ overridePayload: { email: "admin@supreme.example" } });
  let sawMethod = null;
  const env = baseEnv({
    SUPREMEKV: {
      async fetch(req) {
        sawMethod = req.method;
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    },
  });
  const request = new Request("https://example.com/api/edits", {
    method: "POST",
    headers: withAuthHeader({ "Content-Type": "application/json" }, token),
    body: JSON.stringify({ edits: {}, deleted: [], newInvs: [] }),
  });
  const res = await worker.fetch(request, env);
  assert.equal(res.status, 200);
  assert.equal(sawMethod, "POST");
});

// ---------------------------------------------------------------------
// 8. POST prohibido para tecnico
// ---------------------------------------------------------------------

test("worker: technician POST /api/edits -> 403, never reaches SUPREMEKV", async () => {
  const token = await makeToken({ overridePayload: { email: "luis@supreme.example" } });
  let backendCalled = false;
  const env = baseEnv({
    SUPREMEKV: {
      async fetch() {
        backendCalled = true;
        return new Response("should not be called", { status: 200 });
      },
    },
  });
  const request = new Request("https://example.com/api/edits", {
    method: "POST",
    headers: withAuthHeader({ "Content-Type": "application/json" }, token),
    body: JSON.stringify({}),
  });
  const res = await worker.fetch(request, env);
  assert.equal(res.status, 403);
  assert.equal(backendCalled, false);
});

// ---------------------------------------------------------------------
// 9. GET filtrado para tecnico
// ---------------------------------------------------------------------

test("worker: technician GET /api/edits is filtered down to their own invoices only", async () => {
  const token = await makeToken({ overridePayload: { email: "luis@supreme.example" } });
  const env = baseEnv({
    SUPREMEKV: {
      async fetch() {
        return new Response(
          JSON.stringify({
            edits: {},
            deleted: [],
            newInvs: [
              { wo: "1", _creadoPor: "luis@supreme.example" },
              { wo: "2", _creadoPor: "shawn@supreme.example" },
              { wo: "3", tech: { name: "Luis" } },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      },
    },
  });
  const request = new Request("https://example.com/api/edits", { headers: withAuthHeader({}, token) });
  const res = await worker.fetch(request, env);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(
    data.newInvs.map((i) => i.wo).sort(),
    ["1", "3"]
  );
});

// ---------------------------------------------------------------------
// 10. proxy /api/*
// ---------------------------------------------------------------------

test("worker: an unlisted /api/* route is proxied to SUPREMEKV for admin, with verified-identity headers attached", async () => {
  const token = await makeToken({ overridePayload: { email: "admin@supreme.example" } });
  let sawRequest = null;
  const env = baseEnv({
    SUPREMEKV: {
      async fetch(req) {
        sawRequest = req;
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    },
  });
  const request = new Request("https://example.com/api/something-future", { headers: withAuthHeader({}, token) });
  const res = await worker.fetch(request, env);
  assert.equal(res.status, 200);
  assert.equal(new URL(sawRequest.url).pathname, "/something-future");
  assert.equal(sawRequest.headers.get("X-Verified-Email"), "admin@supreme.example");
  assert.equal(sawRequest.headers.get("X-Verified-Role"), "admin");
});

// ---------------------------------------------------------------------
// 11. /api/servicios
// ---------------------------------------------------------------------

test("worker: technician POST /api/servicios creates a BORRADOR submission tagged with their verified email, ignoring client-supplied totals/status", async () => {
  const token = await makeToken({ overridePayload: { email: "luis@supreme.example" } });
  let savedNewInvs = null;
  const env = baseEnv({
    SUPREMEKV: {
      async fetch(req) {
        if (req.method === "GET") {
          return new Response(JSON.stringify({ edits: {}, deleted: [], newInvs: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        const body = await req.json();
        savedNewInvs = body.newInvs;
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    },
  });
  const request = new Request("https://example.com/api/servicios", {
    method: "POST",
    headers: withAuthHeader({ "Content-Type": "application/json" }, token),
    body: JSON.stringify({ wo: "9999", total: 5000, status: "PAID", number: "forged" }),
  });
  const res = await worker.fetch(request, env);
  assert.equal(res.status, 200);
  assert.equal(savedNewInvs.length, 1);
  assert.equal(savedNewInvs[0]._creadoPor, "luis@supreme.example");
  assert.equal(savedNewInvs[0].status, "BORRADOR");
  assert.equal(savedNewInvs[0].total, 0);
  assert.equal(savedNewInvs[0].number, undefined);
});

// ---------------------------------------------------------------------
// 12-13. /api/vision con y sin secreto
// ---------------------------------------------------------------------

test("worker: /api/vision with ANTHROPIC_API_KEY configured proxies to Anthropic and relays the response", async () => {
  const token = await makeToken();
  const env = baseEnv({ ANTHROPIC_API_KEY: "sk-test-secret" });
  const request = new Request("https://example.com/api/vision", {
    method: "POST",
    headers: withAuthHeader({ "Content-Type": "application/json" }, token),
    body: JSON.stringify({ prompt: "describe this invoice photo" }),
  });
  const res = await worker.fetch(request, env);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.mock, "anthropic-response");
});

test("worker: /api/vision without ANTHROPIC_API_KEY fails closed with 500, never calls Anthropic", async () => {
  const token = await makeToken();
  const env = baseEnv(); // no ANTHROPIC_API_KEY
  const request = new Request("https://example.com/api/vision", {
    method: "POST",
    headers: withAuthHeader({ "Content-Type": "application/json" }, token),
    body: JSON.stringify({ prompt: "describe this invoice photo" }),
  });
  const res = await worker.fetch(request, env);
  assert.equal(res.status, 500);
});
