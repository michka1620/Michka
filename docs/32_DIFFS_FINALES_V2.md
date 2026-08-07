# Diffs finales, v2 — Access sobre toda la app (NO aplicados, NO desplegados)

Reemplaza `docs/29` (esa versión solo protegía `/api/*`). Pegados también directamente en la respuesta del chat, sin secretos, tal como pediste.

## 1. `_worker.js` (Worker frontal — verifica JWT para TODA solicitud, no solo `/api/*`)

```diff
+// --- Verificacion JWT de Cloudflare Access, Web Crypto nativo, sin dependencias ---
+function base64urlToUint8Array(base64url) {
+  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
+    .padEnd(base64url.length + (4 - base64url.length % 4) % 4, '=');
+  const binary = atob(base64);
+  const bytes = new Uint8Array(binary.length);
+  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
+  return bytes;
+}
+function base64urlToJson(base64url) {
+  return JSON.parse(new TextDecoder().decode(base64urlToUint8Array(base64url)));
+}
+
+let _jwksCache = null, _jwksCacheAt = 0;
+async function getAccessJWKS(teamDomain, forceRefresh) {
+  const now = Date.now();
+  if (!forceRefresh && _jwksCache && (now - _jwksCacheAt) < 3600000) return _jwksCache;
+  let resp;
+  try { resp = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`); }
+  catch (e) { return null; } // fallo de red -> fail closed
+  if (!resp.ok) return null; // fail closed
+  let jwks;
+  try { jwks = await resp.json(); } catch (e) { return null; }
+  _jwksCache = jwks; _jwksCacheAt = now;
+  return jwks;
+}
+
+async function verifyAccessJWT(token, teamDomain, aud) {
+  const parts = token.split('.');
+  if (parts.length !== 3) return null;
+  const [headerB64, payloadB64, sigB64] = parts;
+
+  let header, payload;
+  try { header = base64urlToJson(headerB64); payload = base64urlToJson(payloadB64); }
+  catch (e) { return null; }
+
+  const now = Date.now() / 1000;
+  if (!payload.exp || now >= payload.exp) return null;                 // expiracion
+  if (payload.nbf && now < payload.nbf) return null;                    // not-before
+  if (payload.iss !== `https://${teamDomain}`) return null;               // issuer
+  const audClaim = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
+  if (!audClaim.includes(aud)) return null;                                // audience
+
+  let jwks = await getAccessJWKS(teamDomain, false);
+  if (!jwks) return null; // fail closed si no se pudo descargar
+  let jwk = jwks.keys.find(k => k.kid === header.kid);
+  if (!jwk) {
+    jwks = await getAccessJWKS(teamDomain, true); // la clave pudo rotar -- forzar refresco 1 vez
+    if (!jwks) return null;
+    jwk = jwks.keys.find(k => k.kid === header.kid);
+    if (!jwk) return null;
+  }
+
+  let key;
+  try {
+    key = await crypto.subtle.importKey(
+      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
+    );
+  } catch (e) { return null; } // JWK invalida -> fail closed
+
+  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
+  const signature = base64urlToUint8Array(sigB64);
+  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signedData);
+  if (!valid) return null;                                                  // firma
+
+  return payload; // solo se llega aqui si TODO paso
+}
+
+const ROLES = {
+  // se completa con los 3 correos reales -- vive en el codigo desplegado, no en el chat
+};
+
 export default {
   async fetch(request, env) {
     const url = new URL(request.url);
+
+    // Verificacion para TODA solicitud -- no solo /api/* -- defensa en profundidad
+    // aunque Access ya proteja todo el hostname en el borde (asi lo recomienda Cloudflare).
+    const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
+    const payload = jwt ? await verifyAccessJWT(jwt, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD) : null;
+    if (!payload || !payload.email) {
+      return new Response('Unauthorized', { status: 401 });
+    }
+    const role = ROLES[payload.email] || 'tecnico';
+
+    if (url.pathname.startsWith('/api/')) {
+      const innerUrl = new URL(request.url);
+      innerUrl.pathname = url.pathname.replace(/^\/api/, '') || '/';
+
+      const innerHeaders = new Headers();
+      innerHeaders.set('Content-Type', request.headers.get('Content-Type') || 'application/json');
+      innerHeaders.set('X-Verified-Email', payload.email);
+      innerHeaders.set('X-Verified-Role', role);
+
+      const innerRequest = new Request(innerUrl.toString(), {
+        method: request.method,
+        headers: innerHeaders,
+        body: (request.method === 'GET' || request.method === 'HEAD') ? undefined : request.body,
+      });
+      return env.SUPREMEKV.fetch(innerRequest);
+    }
+
     // Strip cache-busting query params before fetching asset
     const cleanUrl = new URL(request.url);
     cleanUrl.search = '';
     const assetRequest = new Request(cleanUrl.toString(), request);
     const response = await env.ASSETS.fetch(assetRequest);
     ... (resto sin cambios)
```

## 2. `worker-supremekv1/worker.js` (Worker de datos — confía en el binding, no vuelve a tocar JWT)

```diff
     function checkAuth() {
-      return request.headers.get('x-api-key') === env.SYNC_KEY;
+      // Solo se alcanza via el Service Binding desde bold-mouse-3bc3 -- sin ruta publica.
+      return !!request.headers.get('X-Verified-Email');
+    }
+    function currentRole() {
+      return request.headers.get('X-Verified-Role') || 'tecnico';
     }
```
```diff
     if (url.pathname === '/edits') {
       if (request.method === 'GET') {
+        if (!checkAuth()) return new Response('Unauthorized', { status: 401, headers: cors });
         const [editRows, delRows, newRows] = await Promise.all([...]);
```
(mismo patrón en `GET /sent`)
```diff
         if (body.wipeAll === true) {
+          if (currentRole() !== 'admin') {
+            return new Response('Solo administradora', { status: 403, headers: cors });
+          }
           if (env.ALLOW_WIPE !== 'true') {
             return new Response('wipeAll is disabled', { status: 403, headers: cors });
           }
           await env.SUPREME_DB.batch([...]);
           return json({ status: 'ok', wiped: true });
         }
```

**Nota sobre `wipeAll`:** queda rechazado por defecto (sin `ALLOW_WIPE=true` no ejecuta nada, aunque el rol sea admin). Es "inexistente en la práctica" mientras no actives esa variable a propósito, pero el código de restauración administrativa queda disponible para cuando de verdad haga falta. Si prefieres que se elimine por completo el bloque en vez de dejarlo gateado, dímelo y se quita entero — ambas opciones cumplen "rechazado".

## 3. `index.html`

```diff
-var KV_API = 'https://supremekv1.michka1620.workers.dev/sent';
-var KV_EDITS_API = 'https://supremekv1.michka1620.workers.dev/edits';
-// Must match the SYNC_KEY secret configured on the supremekv1 Worker.
-var SYNC_KEY = '<REDACTADO>';
+var KV_API = '/api/sent';
+var KV_EDITS_API = '/api/edits';
 
 function _syncHeaders() {
-  return { 'Content-Type': 'application/json', 'x-api-key': SYNC_KEY };
+  return { 'Content-Type': 'application/json' };
+}
+function _syncFetchOpts(extra) {
+  return Object.assign({ credentials: 'include' }, extra || {});
 }
```
```diff
-  if (location.search.indexOf('reset=1') >= 0) {
-    localStorage.removeItem('sup_edits');
-    localStorage.removeItem('sup_deleted');
-    localStorage.removeItem('sup_new');
-    localStorage.removeItem('sup_edits_prev');
-    localStorage.removeItem('sup_edit_ts');
-    localStorage.removeItem('sup_new_prev');
-    localStorage.removeItem('sup_new_ts');
-    localStorage.removeItem('sup_known_new_keys');
-    localStorage.removeItem('sup_sync_pending');
-    fetch('https://supremekv1.michka1620.workers.dev/edits', {method:'POST',headers:_syncHeaders(),body:JSON.stringify({wipeAll:true})}).catch(function(){});
-    history.replaceState(null,'',location.pathname);
-  }
```
(bloque eliminado por completo — ninguna llamada a `wipeAll` queda en el frontend)

```diff
 function showPendingBanner(pendingCount) {
   ...
-  // estado 'error': "❌ Sin conexión al servidor de datos"
+  // estado 'error': mensaje de mantenimiento, mientras dure la migracion a Access
+  banner.textContent = '🔧 Sincronización temporalmente deshabilitada por mantenimiento de seguridad. Los datos locales no se han eliminado.';
```

(cada `fetch(KV_EDITS_API,...)`/`fetch(KV_API,...)` agrega `credentials:'include'` vía `_syncFetchOpts`)

## 4. Service Binding — producción

```toml
# wrangler.toml (bold-mouse-3bc3)
[[services]]
binding = "SUPREMEKV"
service = "supremekv1"
```

## 5. Service Binding — staging

```toml
# wrangler.staging.toml (bold-mouse-3bc3-staging) -- archivo separado
[[services]]
binding = "SUPREMEKV"
service = "supremekv1-staging"
```

## 6. Configuración de Access (manual, tuya — no código)

- Application: hostname `bold-mouse-3bc3.michka1620.workers.dev`, **sin restricción de ruta** (todo el sitio, no solo `/api/*`).
- Política: los 3 correos, login por OTP.
- Duración de sesión: a definir por ti (recomendado ~24h).
- Repetir la misma configuración, apuntando al frontend de staging, para las pruebas.

## Plan de reversión

Sin cambios respecto a lo ya descrito en `docs/23`/`docs/25`: todo es código + configuración aditiva, reversible con `git revert` y desactivando la Access Application o el Service Binding desde el dashboard — nada de esto toca datos.

## Confirmación — producción sigue intacta
