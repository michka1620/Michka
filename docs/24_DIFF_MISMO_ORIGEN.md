# Diff exacto — arquitectura de mismo origen (NO aplicado, NO desplegado)

## `wrangler.toml` (Worker `bold-mouse-3bc3`, el frontend)

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

## `_worker.js` (frontend — agrega el reenvío interno a `/api/*`)

```diff
 export default {
   async fetch(request, env) {
     const url = new URL(request.url);
+    if (url.pathname.startsWith('/api/')) {
+      const innerUrl = new URL(request.url);
+      innerUrl.pathname = url.pathname.replace(/^\/api/, '') || '/';
+      const innerRequest = new Request(innerUrl.toString(), request);
+      return env.SUPREMEKV.fetch(innerRequest); // llamada interna, no sale a internet
+    }
     // Strip cache-busting query params before fetching asset
     const cleanUrl = new URL(request.url);
     cleanUrl.search = '';
     const assetRequest = new Request(cleanUrl.toString(), request);
     const response = await env.ASSETS.fetch(assetRequest);
     ...
```

## `worker-supremekv1/worker.js` (datos — valida el JWT, ya no compara contra `SYNC_KEY`)

```diff
+import { createRemoteJWKSet, jwtVerify } from 'jose';
+
 export default {
   async fetch(request, env) {
     const url = new URL(request.url);
     const cors = { ... };
     if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

-    function checkAuth() {
-      return request.headers.get('x-api-key') === env.SYNC_KEY;
+    const JWKS = createRemoteJWKSet(new URL(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`));
+    const ROLES = {
+      // se completa con los 3 correos reales -- vive en el Worker, no en el chat
+    };
+    async function currentUser() {
+      const token = request.headers.get('Cf-Access-Jwt-Assertion');
+      if (!token) return null;
+      try {
+        const { payload } = await jwtVerify(token, JWKS, {
+          issuer: `https://${env.ACCESS_TEAM_DOMAIN}`,
+          audience: env.ACCESS_AUD,
+        });
+        return { email: payload.email, role: ROLES[payload.email] || 'tecnico' };
+      } catch (e) {
+        return null; // firma invalida, issuer/audience incorrecto, o expirado
+      }
+    }
+    async function checkAuth() {
+      return (await currentUser()) !== null;
     }
```

```diff
     if (url.pathname === '/edits') {
       if (request.method === 'GET') {
-        // (sin verificacion)
+        if (!(await checkAuth())) return new Response('Unauthorized', { status: 401, headers: cors });
         const [editRows, delRows, newRows] = await Promise.all([...]);
```
(mismo patrón para `GET /sent`, y `checkAuth()` reemplaza cada `if (!checkAuth())` existente en los bloques `POST`, ahora usando `await`)

```diff
         if (body.wipeAll === true) {
+          const user = await currentUser();
+          if (!user || user.role !== 'admin') {
+            return new Response('Solo administradora', { status: 403, headers: cors });
+          }
           if (env.ALLOW_WIPE !== 'true') {
             return new Response('wipeAll is disabled', { status: 403, headers: cors });
           }
           ...
```

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

(cada `fetch(KV_EDITS_API, {...})` / `fetch(KV_API, {...})` agrega `credentials:'include'` vía `_syncFetchOpts`; el bloque completo de `?reset=1` se elimina, igual que en `docs/16`, diff B.2 — sin cambios respecto a esa propuesta.)

## No cambia

Ningún cambio a D1, a `schema.sql`, a ninguna factura, ni a los totales — este diff es exclusivamente de acceso/enrutamiento.
