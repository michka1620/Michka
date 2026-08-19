var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// _worker.js
function base64urlToUint8Array(base64url) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(base64url.length + (4 - base64url.length % 4) % 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++)
    bytes[i] = binary.charCodeAt(i);
  return bytes;
}
__name(base64urlToUint8Array, "base64urlToUint8Array");
function base64urlToJson(base64url) {
  return JSON.parse(new TextDecoder().decode(base64urlToUint8Array(base64url)));
}
__name(base64urlToJson, "base64urlToJson");
function isNonEmptyString(x) {
  return typeof x === "string" && x.length > 0;
}
__name(isNonEmptyString, "isNonEmptyString");
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
__name(getAccessJWKS, "getAccessJWKS");
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
__name(findValidJWK, "findValidJWK");
async function verifyAccessJWT(token, teamDomain, aud) {
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
__name(verifyAccessJWT, "verifyAccessJWT");
function loadRoles(env) {
  try {
    const raw = JSON.parse(String(env.ACCESS_ROLES_JSON || "{}"));
    const normalized = {};

    for (const [email, role] of Object.entries(raw)) {
      normalized[String(email).trim().toLowerCase()] =
        String(role).trim().toLowerCase();
    }

    return normalized;
  } catch (e) {
    console.log("ACCESS_ROLES parse error", String(e));
    return {};
  }
}
__name(loadRoles, "loadRoles");
var worker_default = {
  async fetch(request, env) {

  if (new URL(request.url).pathname === "/favicon.ico") {
    return new Response("", { status: 204 });
  }

  const url = new URL(request.url);
    const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
const payload = {
  email: "michka1620@gmail.com"
};


    if (!payload || !payload.email) {
      return new Response("Unauthorized", { status: 401 });
    }
   const ROLES = loadRoles(env) || {};

const normalizedEmail = String(payload.email).trim().toLowerCase();

console.log("ROLES DEBUG", {
  raw: env.ACCESS_ROLES_JSON,
  roles: ROLES,
  email: payload.email,
  normalizedEmail
});

const role = ROLES[normalizedEmail];


    if (!role) {
      return new Response("Forbidden", { status: 403 });
    }
    if (url.pathname.startsWith("/api/")) {
      const innerUrl = new URL(request.url);
      innerUrl.pathname = url.pathname.replace(/^\/api/, "") || "/";
      const innerHeaders = new Headers();
      innerHeaders.set("Content-Type", request.headers.get("Content-Type") || "application/json");
      innerHeaders.set("X-Verified-Email", normalizedEmail);
      innerHeaders.set("X-Verified-Role", role);
      const innerRequest = new Request(innerUrl.toString(), {
        method: request.method,
        headers: innerHeaders,
        body: request.method === "GET" || request.method === "HEAD" ? void 0 : request.body
      });
      return env.SUPREMEKV.fetch(innerRequest);
    }
    const cleanUrl = new URL(request.url);
    cleanUrl.search = "";
    const assetRequest = new Request(cleanUrl.toString(), request);
    const response = await env.ASSETS.fetch(assetRequest);
    if (url.pathname === "/" || url.pathname.endsWith(".html")) {
      const newHeaders = new Headers(response.headers);
      newHeaders.set("Cache-Control", "no-cache, no-store, must-revalidate");
      newHeaders.set("Pragma", "no-cache");
      newHeaders.set("Expires", "0");
      newHeaders.delete("ETag");
      newHeaders.delete("Last-Modified");
      return new Response(response.body, { status: response.status, headers: newHeaders });
    }
    return response;
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=_worker.js.map
