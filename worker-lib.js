// Shared, testable core of the Worker: JWT verification, roles, and
// request authorization/routing decisions. Kept dependency-free (only
// Web Crypto + fetch) so the exact same code runs in the deployed Worker
// and in Node's built-in test runner.

function base64urlToUint8Array(base64url) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(base64url.length + (4 - base64url.length % 4) % 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++)
    bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64urlToJson(base64url) {
  return JSON.parse(new TextDecoder().decode(base64urlToUint8Array(base64url)));
}

function isNonEmptyString(x) {
  return typeof x === "string" && x.length > 0;
}

var _jwksCache = null;
var _jwksCacheAt = 0;
async function getAccessJWKS(teamDomain, forceRefresh) {
  const now = Date.now();
  if (!forceRefresh && _jwksCache && now - _jwksCacheAt < 36e5)
    return _jwksCache;
  let resp;
  try {
    resp = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  } catch (e) {
    return null;
  }
  if (!resp.ok)
    return null;
  let jwks;
  try {
    jwks = await resp.json();
  } catch (e) {
    return null;
  }
  _jwksCache = jwks;
  _jwksCacheAt = now;
  return jwks;
}

// Exposed for tests only, so a test run doesn't leak cached JWKS between cases.
function _resetJWKSCache() {
  _jwksCache = null;
  _jwksCacheAt = 0;
}

function findValidJWK(jwks, kid) {
  const jwk = (jwks.keys || []).find((k) => k.kid === kid);
  if (!jwk)
    return null;
  if (jwk.kty !== void 0 && jwk.kty !== "RSA")
    return null;
  if (jwk.use !== void 0 && jwk.use !== "sig")
    return null;
  if (jwk.key_ops !== void 0 && Array.isArray(jwk.key_ops) && !jwk.key_ops.includes("verify"))
    return null;
  return jwk;
}

async function verifyAccessJWT(token, teamDomain, aud) {
  if (!isNonEmptyString(token)) return null;
  const parts = token.split(".");
  if (parts.length !== 3)
    return null;
  const [headerB64, payloadB64, sigB64] = parts;
  let header, payload;
  try {
    header = base64urlToJson(headerB64);
    payload = base64urlToJson(payloadB64);
  } catch (e) {
    return null;
  }
  if (header.alg !== "RS256")
    return null;
  if (!isNonEmptyString(header.kid))
    return null;
  if (!isNonEmptyString(payload.email))
    return null;
  const now = Date.now() / 1e3;
  if (!payload.exp || now >= payload.exp)
    return null;
  if (payload.nbf && now < payload.nbf)
    return null;
  if (payload.iss !== `https://${teamDomain}`)
    return null;
  const audClaim = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audClaim.includes(aud))
    return null;
  let jwks = await getAccessJWKS(teamDomain, false);
  if (!jwks)
    return null;
  let jwk = findValidJWK(jwks, header.kid);
  if (!jwk) {
    jwks = await getAccessJWKS(teamDomain, true);
    if (!jwks)
      return null;
    jwk = findValidJWK(jwks, header.kid);
    if (!jwk)
      return null;
  }
  let key;
  try {
    key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
  } catch (e) {
    return null;
  }
  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64urlToUint8Array(sigB64);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signedData);
  if (!valid)
    return null;
  return payload;
}

function loadRoles(env) {
  try {
    const raw = JSON.parse(String(env.ACCESS_ROLES_JSON || "{}"));
    const normalized = {};
    for (const [email, role] of Object.entries(raw)) {
      normalized[String(email).trim().toLowerCase()] = String(role).trim().toLowerCase();
    }
    return normalized;
  } catch (e) {
    return {};
  }
}

// Maps a verified email to the free-text technician name used historically
// in invoice.tech.name (e.g. "luis@..." -> "Luis"), via env.ACCESS_TECH_NAMES_JSON.
// Used only to let a technician see their own pre-existing invoices; every
// NEW submission is tagged with the verified email directly (_creadoPor)
// and never needs this mapping.
function loadTechNames(env) {
  try {
    const raw = JSON.parse(String(env.ACCESS_TECH_NAMES_JSON || "{}"));
    const normalized = {};
    for (const [email, name] of Object.entries(raw)) {
      normalized[String(email).trim().toLowerCase()] = String(name).trim();
    }
    return normalized;
  } catch (e) {
    return {};
  }
}

// Authenticates one request: verifies the Access JWT and resolves a role.
// Returns { ok: true, email, role } or { ok: false, status, message }.
async function authenticate(request, env) {
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!isNonEmptyString(jwt)) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN;
  const aud = env.CF_ACCESS_AUD;
  if (!isNonEmptyString(teamDomain) || !isNonEmptyString(aud)) {
    return { ok: false, status: 500, message: "Server misconfigured: missing Access settings" };
  }
  const payload = await verifyAccessJWT(jwt, teamDomain, aud);
  if (!payload || !payload.email) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }
  const email = String(payload.email).trim().toLowerCase();
  const roles = loadRoles(env);
  const role = roles[email];
  if (!role) {
    return { ok: false, status: 403, message: "Forbidden" };
  }
  return { ok: true, email, role };
}

// Decides what an authenticated request is allowed to do, independent of
// actually performing it -- kept pure so it's trivial to unit test every
// combination of role + method + path without a network call.
function authorizeRoute(role, method, pathname) {
  const isApi = pathname.startsWith("/api/");
  if (!isApi) {
    return { allow: true, kind: "asset" };
  }
  if (pathname === "/api/vision") {
    return { allow: true, kind: "vision" };
  }
  if (pathname === "/api/servicios") {
    if (method === "POST") return { allow: true, kind: "servicio_submit" };
    return { allow: false, status: 405, message: "Method not allowed" };
  }
  if (pathname.startsWith("/api/edits")) {
    if (role === "admin") return { allow: true, kind: "edits_full" };
    if (role === "tecnico" && method === "GET") return { allow: true, kind: "edits_read_own" };
    return { allow: false, status: 403, message: "Forbidden" };
  }
  // Any other /api/* route: admin only, proxied as-is (matches today's
  // behavior for routes we haven't split out yet).
  if (role === "admin") return { allow: true, kind: "proxy_full" };
  return { allow: false, status: 403, message: "Forbidden" };
}

// Filters a /api/edits GET response body ({edits, deleted, newInvs}) down
// to only the invoices a technician is allowed to see: ones they submitted
// themselves (_creadoPor) or, for pre-existing data, ones whose tech.name
// matches their known display name.
function filterEditsForTechnician(data, email, techNames) {
  const displayName = techNames[email];
  const newInvs = Array.isArray(data.newInvs) ? data.newInvs : [];
  const filtered = newInvs.filter((inv) => {
    if (inv._creadoPor && String(inv._creadoPor).trim().toLowerCase() === email) return true;
    if (displayName && inv.tech && String(inv.tech.name || "").trim() === displayName) return true;
    return false;
  });
  return { edits: {}, deleted: [], newInvs: filtered };
}

export {
  base64urlToUint8Array,
  base64urlToJson,
  isNonEmptyString,
  getAccessJWKS,
  _resetJWKSCache,
  findValidJWK,
  verifyAccessJWT,
  loadRoles,
  loadTechNames,
  authenticate,
  authorizeRoute,
  filterEditsForTechnician,
};
