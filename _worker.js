// Frontend Worker -- STAGING variant (bold-mouse-3bc3-staging).
// Verifies every request's Cloudflare Access JWT itself (defense in depth, even though
// Access already gates the whole origin at Cloudflare's edge) and forwards /api/* to the
// internal data Worker via the "SUPREMEKV" Service Binding. See:
//   docs/25_AUTORIDAD_UNICA_Y_UBICACION_ACCESS.md
//   docs/34_CORRECCIONES_SEGURIDAD_V3.md

function base64urlToUint8Array(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(base64url.length + (4 - base64url.length % 4) % 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function base64urlToJson(base64url) {
  return JSON.parse(new TextDecoder().decode(base64urlToUint8Array(base64url)));
}
function isNonEmptyString(x) { return typeof x === 'string' && x.length > 0; }

let _jwksCache = null, _jwksCacheAt = 0;
async function getAccessJWKS(teamDomain, forceRefresh) {
  const now = Date.now();
  if (!forceRefresh && _jwksCache && (now - _jwksCacheAt) < 3600000) return _jwksCache; // cache 1h
  let resp;
  try { resp = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`); }
  catch (e) { return null; } // fallo de red -> fail closed
  if (!resp.ok) return null; // fail closed
  let jwks;
  try { jwks = await resp.json(); } catch (e) { return null; }
  _jwksCache = jwks; _jwksCacheAt = now;
  return jwks;
}

function findValidJWK(jwks, kid) {
  const jwk = (jwks.keys || []).find(k => k.kid === kid);
  if (!jwk) return null;
  if (jwk.kty !== undefined && jwk.kty !== 'RSA') return null;
  if (jwk.use !== undefined && jwk.use !== 'sig') return null;
  if (jwk.key_ops !== undefined && Array.isArray(jwk.key_ops) && !jwk.key_ops.includes('verify')) return null;
  return jwk;
}

async function verifyAccessJWT(token, teamDomain, aud) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let header, payload;
  try {
    header = base64urlToJson(headerB64);
    payload = base64urlToJson(payloadB64);
  } catch (e) { return null; }

  // --- Antes de tocar la JWK: validar header y claims ---
  if (header.alg !== 'RS256') return null;              // ningun otro algoritmo se acepta
  if (!isNonEmptyString(header.kid)) return null;
  if (!isNonEmptyString(payload.email)) return null;

  const now = Date.now() / 1000;
  if (!payload.exp || now >= payload.exp) return null;    // expiracion
  if (payload.nbf && now < payload.nbf) return null;        // not-before, si existe
  if (payload.iss !== `https://${teamDomain}`) return null;    // issuer
  const audClaim = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audClaim.includes(aud)) return null;                     // audience

  // --- Seleccion y validacion de la JWK ---
  let jwks = await getAccessJWKS(teamDomain, false);
  if (!jwks) return null; // fallo al descargar -> fail closed
  let jwk = findValidJWK(jwks, header.kid);
  if (!jwk) {
    jwks = await getAccessJWKS(teamDomain, true); // la clave pudo rotar -- forzar refresco 1 vez
    if (!jwks) return null;
    jwk = findValidJWK(jwks, header.kid);
    if (!jwk) return null;
  }

  let key;
  try {
    key = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
  } catch (e) { return null; }

  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64urlToUint8Array(sigB64);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signedData);
  if (!valid) return null;                                        // firma

  return payload; // solo si TODO lo de arriba paso
}

function loadRoles(env) {
  try {
    const raw = JSON.parse(env.ACCESS_ROLES_JSON || '{}');
    const normalized = {};
    for (const email of Object.keys(raw)) {
      normalized[email.trim().toLowerCase()] = raw[email];
    }
    return normalized;
  } catch (e) {
    return {}; // JSON invalido -> nadie tiene rol -> todo se rechaza (fail closed)
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Verificacion para TODA solicitud -- no solo /api/* -- defensa en profundidad,
    // aunque Access ya proteja todo el hostname en el borde (lo recomienda Cloudflare).
    const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
    const payload = jwt ? await verifyAccessJWT(jwt, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD) : null;
    if (!payload || !payload.email) {
      return new Response('Unauthorized', { status: 401 });
    }
    const ROLES = loadRoles(env);
    const normalizedEmail = String(payload.email).trim().toLowerCase();
    const role = ROLES[normalizedEmail];
    if (!role) {
      return new Response('Forbidden', { status: 403 });
    }

    if (url.pathname.startsWith('/api/')) {
      const innerUrl = new URL(request.url);
      innerUrl.pathname = url.pathname.replace(/^\/api/, '') || '/';

      // IMPORTANTE: se construye un Headers() vacio y se llena a mano -- NUNCA se copian
      // los headers de la solicitud original. Ningun X-Verified-* que el cliente hubiera
      // mandado puede llegar aqui, porque nunca se leen ni se reenvian.
      const innerHeaders = new Headers();
      innerHeaders.set('Content-Type', request.headers.get('Content-Type') || 'application/json');
      innerHeaders.set('X-Verified-Email', normalizedEmail);
      innerHeaders.set('X-Verified-Role', role);

      const innerRequest = new Request(innerUrl.toString(), {
        method: request.method,
        headers: innerHeaders,
        body: (request.method === 'GET' || request.method === 'HEAD') ? undefined : request.body,
      });
      return env.SUPREMEKV.fetch(innerRequest);
    }

    // Strip cache-busting query params before fetching asset
    const cleanUrl = new URL(request.url);
    cleanUrl.search = '';
    const assetRequest = new Request(cleanUrl.toString(), request);
    const response = await env.ASSETS.fetch(assetRequest);
    if (url.pathname === '/' || url.pathname.endsWith('.html')) {
      const newHeaders = new Headers(response.headers);
      newHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      newHeaders.set('Pragma', 'no-cache');
      newHeaders.set('Expires', '0');
      newHeaders.delete('ETag');
      newHeaders.delete('Last-Modified');
      return new Response(response.body, { status: response.status, headers: newHeaders });
    }
    return response;
  }
};
