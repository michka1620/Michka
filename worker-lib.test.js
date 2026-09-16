// Unit tests for worker-lib.js. Pure Node, no wrangler, no network, no
// real Cloudflare account -- uses a synthetic RS256 keypair to stand in
// for a real Cloudflare Access team, and mocks global fetch for the JWKS
// endpoint only. Run with: node --test worker-lib.test.js
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  verifyAccessJWT,
  loadRoles,
  loadTechNames,
  authenticate,
  authorizeRoute,
  filterEditsForTechnician,
  _resetJWKSCache,
} from "./worker-lib.js";

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

  // Mock the JWKS endpoint (`https://<team>/cdn-cgi/access/certs`) only;
  // anything else falls through to a clear failure so a stray real network
  // call is never silently swallowed.
  global.fetch = async (url) => {
    if (String(url) === `https://${TEAM_DOMAIN}/cdn-cgi/access/certs`) {
      return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
    }
    throw new Error("Unexpected fetch in test: " + url);
  };
});

beforeEach(() => {
  _resetJWKSCache();
});

async function makeToken({ overridePayload = {}, kid = KID, alg = "RS256", corruptSignature = false } = {}) {
  const header = { alg, kid, typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    email: "luis@supreme.example",
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
  let sigBytes = new Uint8Array(sigBuf);
  if (corruptSignature) sigBytes = sigBytes.map((b, i) => (i === 0 ? b ^ 0xff : b));
  const sigB64 = toBase64url(sigBytes);
  return `${headerB64}.${payloadB64}.${sigB64}`;
}

test("verifyAccessJWT: accepts a validly signed, well-formed token", async () => {
  const token = await makeToken();
  const payload = await verifyAccessJWT(token, TEAM_DOMAIN, AUD);
  assert.ok(payload);
  assert.equal(payload.email, "luis@supreme.example");
});

test("verifyAccessJWT: rejects an expired token", async () => {
  const token = await makeToken({ overridePayload: { exp: Math.floor(Date.now() / 1000) - 10 } });
  const payload = await verifyAccessJWT(token, TEAM_DOMAIN, AUD);
  assert.equal(payload, null);
});

test("verifyAccessJWT: rejects a token not yet valid (nbf in the future)", async () => {
  const token = await makeToken({ overridePayload: { nbf: Math.floor(Date.now() / 1000) + 3600 } });
  const payload = await verifyAccessJWT(token, TEAM_DOMAIN, AUD);
  assert.equal(payload, null);
});

test("verifyAccessJWT: rejects wrong audience", async () => {
  const token = await makeToken({ overridePayload: { aud: "someone-elses-app" } });
  const payload = await verifyAccessJWT(token, TEAM_DOMAIN, AUD);
  assert.equal(payload, null);
});

test("verifyAccessJWT: rejects wrong issuer", async () => {
  const token = await makeToken({ overridePayload: { iss: "https://not-our-team.cloudflareaccess.com" } });
  const payload = await verifyAccessJWT(token, TEAM_DOMAIN, AUD);
  assert.equal(payload, null);
});

test("verifyAccessJWT: rejects a tampered signature", async () => {
  const token = await makeToken({ corruptSignature: true });
  const payload = await verifyAccessJWT(token, TEAM_DOMAIN, AUD);
  assert.equal(payload, null);
});

test("verifyAccessJWT: rejects an unsupported alg", async () => {
  const token = await makeToken({ alg: "none" });
  const payload = await verifyAccessJWT(token, TEAM_DOMAIN, AUD);
  assert.equal(payload, null);
});

test("verifyAccessJWT: rejects missing email claim", async () => {
  const token = await makeToken({ overridePayload: { email: undefined } });
  const payload = await verifyAccessJWT(token, TEAM_DOMAIN, AUD);
  assert.equal(payload, null);
});

test("verifyAccessJWT: rejects an unknown kid (key rotation / forged kid)", async () => {
  const token = await makeToken({ kid: "some-other-key-id" });
  const payload = await verifyAccessJWT(token, TEAM_DOMAIN, AUD);
  assert.equal(payload, null);
});

test("verifyAccessJWT: rejects a malformed token (wrong number of segments)", async () => {
  const payload = await verifyAccessJWT("not.a.valid.jwt.token", TEAM_DOMAIN, AUD);
  assert.equal(payload, null);
});

test("verifyAccessJWT: rejects null/empty token", async () => {
  assert.equal(await verifyAccessJWT(null, TEAM_DOMAIN, AUD), null);
  assert.equal(await verifyAccessJWT("", TEAM_DOMAIN, AUD), null);
});

test("loadRoles: normalizes email case/whitespace and role case", () => {
  const env = { ACCESS_ROLES_JSON: JSON.stringify({ "  Michelle@Supreme.example ": " Admin " }) };
  const roles = loadRoles(env);
  assert.equal(roles["michelle@supreme.example"], "admin");
});

test("loadRoles: returns {} on malformed JSON instead of throwing", () => {
  const env = { ACCESS_ROLES_JSON: "{not valid json" };
  assert.deepEqual(loadRoles(env), {});
});

test("loadRoles: returns {} when unset", () => {
  assert.deepEqual(loadRoles({}), {});
});

test("authenticate: full flow accepts a valid technician token and resolves role", async () => {
  const token = await makeToken({ overridePayload: { email: "Luis@Supreme.example" } });
  const env = {
    CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    CF_ACCESS_AUD: AUD,
    ACCESS_ROLES_JSON: JSON.stringify({ "luis@supreme.example": "tecnico" }),
  };
  const request = new Request("https://example.com/api/edits", {
    headers: { "Cf-Access-Jwt-Assertion": token },
  });
  const result = await authenticate(request, env);
  assert.equal(result.ok, true);
  assert.equal(result.email, "luis@supreme.example");
  assert.equal(result.role, "tecnico");
});

test("authenticate: 401 when the header is missing entirely", async () => {
  const env = { CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, CF_ACCESS_AUD: AUD, ACCESS_ROLES_JSON: "{}" };
  const request = new Request("https://example.com/api/edits");
  const result = await authenticate(request, env);
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test("authenticate: 500 when CF_ACCESS_TEAM_DOMAIN/AUD are not configured (fail closed, not open)", async () => {
  const token = await makeToken();
  const env = { ACCESS_ROLES_JSON: "{}" };
  const request = new Request("https://example.com/api/edits", {
    headers: { "Cf-Access-Jwt-Assertion": token },
  });
  const result = await authenticate(request, env);
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
});

test("authenticate: 403 when the JWT is valid but the email has no assigned role", async () => {
  const token = await makeToken({ overridePayload: { email: "stranger@example.com" } });
  const env = { CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, CF_ACCESS_AUD: AUD, ACCESS_ROLES_JSON: "{}" };
  const request = new Request("https://example.com/api/edits", {
    headers: { "Cf-Access-Jwt-Assertion": token },
  });
  const result = await authenticate(request, env);
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});

test("authenticate: 401 on a tampered token even with everything else configured correctly", async () => {
  const token = await makeToken({ corruptSignature: true });
  const env = {
    CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    CF_ACCESS_AUD: AUD,
    ACCESS_ROLES_JSON: JSON.stringify({ "luis@supreme.example": "tecnico" }),
  };
  const request = new Request("https://example.com/api/edits", {
    headers: { "Cf-Access-Jwt-Assertion": token },
  });
  const result = await authenticate(request, env);
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test("authorizeRoute: admin can POST /api/edits", () => {
  assert.deepEqual(authorizeRoute("admin", "POST", "/api/edits").allow, true);
});
test("authorizeRoute: tecnico cannot POST /api/edits", () => {
  const d = authorizeRoute("tecnico", "POST", "/api/edits");
  assert.equal(d.allow, false);
  assert.equal(d.status, 403);
});
test("authorizeRoute: tecnico can GET /api/edits (filtered downstream)", () => {
  assert.deepEqual(authorizeRoute("tecnico", "GET", "/api/edits").allow, true);
});
test("authorizeRoute: tecnico can POST /api/servicios", () => {
  assert.deepEqual(authorizeRoute("tecnico", "POST", "/api/servicios").allow, true);
});
test("authorizeRoute: admin can also POST /api/servicios", () => {
  assert.deepEqual(authorizeRoute("admin", "POST", "/api/servicios").allow, true);
});
test("authorizeRoute: GET /api/servicios is not allowed for anyone (submit-only endpoint)", () => {
  const d = authorizeRoute("tecnico", "GET", "/api/servicios");
  assert.equal(d.allow, false);
  assert.equal(d.status, 405);
});
test("authorizeRoute: both roles can reach /api/vision", () => {
  assert.equal(authorizeRoute("tecnico", "POST", "/api/vision").allow, true);
  assert.equal(authorizeRoute("admin", "POST", "/api/vision").allow, true);
});
test("authorizeRoute: an unknown role is forbidden from any /api/* route", () => {
  const d = authorizeRoute("mystery-role", "GET", "/api/edits");
  assert.equal(d.allow, false);
  assert.equal(d.status, 403);
});
test("authorizeRoute: static assets are reachable by any authenticated role", () => {
  assert.equal(authorizeRoute("tecnico", "GET", "/index.html").allow, true);
  assert.equal(authorizeRoute("admin", "GET", "/").allow, true);
});
test("authorizeRoute: an unlisted /api/* route defaults to admin-only", () => {
  assert.equal(authorizeRoute("admin", "GET", "/api/something-future").allow, true);
  assert.equal(authorizeRoute("tecnico", "GET", "/api/something-future").allow, false);
});

test("loadTechNames: normalizes email, keeps display name as-is", () => {
  const env = { ACCESS_TECH_NAMES_JSON: JSON.stringify({ "Shawn@Supreme.example": "Shawn" }) };
  assert.deepEqual(loadTechNames(env), { "shawn@supreme.example": "Shawn" });
});

test("filterEditsForTechnician: keeps only invoices tagged with the technician's own email", () => {
  const data = {
    newInvs: [
      { wo: "1", _creadoPor: "luis@supreme.example", total: 10 },
      { wo: "2", _creadoPor: "shawn@supreme.example", total: 20 },
    ],
  };
  const result = filterEditsForTechnician(data, "luis@supreme.example", {});
  assert.equal(result.newInvs.length, 1);
  assert.equal(result.newInvs[0].wo, "1");
});

test("filterEditsForTechnician: also matches legacy invoices by mapped display name", () => {
  const data = {
    newInvs: [
      { wo: "1", tech: { name: "Danny" }, total: 10 },
      { wo: "2", tech: { name: "Luis" }, total: 20 },
    ],
  };
  const result = filterEditsForTechnician(data, "danny@supreme.example", { "danny@supreme.example": "Danny" });
  assert.equal(result.newInvs.length, 1);
  assert.equal(result.newInvs[0].wo, "1");
});

test("filterEditsForTechnician: a technician with no mapped name and nothing self-tagged sees nothing (fails closed)", () => {
  const data = { newInvs: [{ wo: "1", tech: { name: "Danny" }, total: 10 }] };
  const result = filterEditsForTechnician(data, "unknown@supreme.example", {});
  assert.equal(result.newInvs.length, 0);
});

after(() => {
  delete global.fetch;
});
