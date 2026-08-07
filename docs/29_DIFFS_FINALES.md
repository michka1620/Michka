# 6. Diffs completos, redactados, línea por línea (NO aplicados, NO desplegados)

Reemplaza el diff de `docs/24` (usaba `jose`, que no funciona con el despliegue manual actual de `supremekv1` — ver `docs/26`). Este usa Web Crypto nativo, cero dependencias nuevas, cero cambios a GitHub Actions, cero `package.json` nuevo.

## `wrangler.toml` (raíz — `bold-mouse-3bc3`, producción)

```diff
 name = "bold-mouse-3bc3"
 compatibility_date = "2024-01-01"
 account_id = "62fb45b77a7da33a4614d06fab267b4b"
 main = "_worker.js"
 
 [assets]
 directory = "."
+
+[[services]]
+binding = "SUPREMEKV"
+service = "supremekv1"
```

## `.github/workflows/deploy.yml`

**Sin cambios.** El workflow ya despliega `bold-mouse-3bc3` con `wrangler-action`, que lee `wrangler.toml` — el nuevo bloque `[[services]]` de arriba se recoge automáticamente, sin tocar el YAML del workflow.

## `package.json`

**Ninguno nuevo.** No se agrega ninguna dependencia (ver `docs/26`).

## `_worker.js` (frontend — reenvío a `/api/*`, con headers reconstruidos desde cero)

```diff
+const ACCESS_TEAM_DOMAIN_PLACEHOLDER = null; // vendra de env.ACCESS_TEAM_DOMAIN, no hardcodeado
+
+// --- verificacion JWT (identica a la de docs/26, Web Crypto nativo) ---
+function base64urlToUint8Array(base64url) { /* ver docs/26 */ }
+function base64urlToJson(base64url) { /* ver docs/26 */ }
+async function getAccessJWKS(teamDomain) { /* ver docs/26, con cache de 1h */ }
+async function verifyAccessJWT(token, teamDomain, aud) { /* ver docs/26 */ }
+
+const ROLES = {
+  // se completa con los 3 correos reales -- vive en el codigo desplegado, no en el chat
+};
+
 export default {
   async fetch(request, env) {
     const url = new URL(request.url);
+
+    if (url.pathname.startsWith('/api/')) {
+      const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
+      const payload = jwt ? await verifyAccessJWT(jwt, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD) : null;
+      if (!payload || !payload.email) {
+        return new Response('Unauthorized', { status: 401 });
+      }
+      const role = ROLES[payload.email] || 'tecnico';
+
+      const innerUrl = new URL(request.url);
+      innerUrl.pathname = url.pathname.replace(/^\/api/, '') || '/';
+
+      // Reconstruccion explicita -- NINGUN header del cliente original se reenvia.
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

## `worker-supremekv1/worker.js` (datos — confía en los headers del binding, ya no en `SYNC_KEY`)

```diff
     function checkAuth() {
-      return request.headers.get('x-api-key') === env.SYNC_KEY;
+      // Solo se alcanza este codigo via el Service Binding desde bold-mouse-3bc3 --
+      // no hay ruta publica. X-Verified-Email lo genera ese Worker, nunca el cliente.
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
           ...
```

(la restricción de "solo sus operaciones" de `docs/27` es un diff aparte, más grande, para cuando se autorice esa segunda etapa)

## `index.html`

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

(cada `fetch(KV_EDITS_API,...)`/`fetch(KV_API,...)` agrega `credentials:'include'`; el bloque completo de `?reset=1` se elimina — sin cambios respecto a `docs/16`, diff B.2; mensaje de mantenimiento — sin cambios respecto a `docs/16`, diff B.3)

## Confirmación — no cambia D1, ni facturas, ni totales

Ningún diff de esta lista toca `schema.sql`, ninguna tabla, ni ningún valor de ninguna factura.
