# Diff propuesto — sincronización vía Cloudflare Access (NO aplicado)

No lo apliqué a los archivos reales todavía porque depende de una decisión tuya pendiente (Opción A vs B en `docs/20`) y de valores de tu configuración de Access que no necesito conocer (dominio de equipo, AUD tag) pero que si cambian, cambian una línea de la URL — mejor fijar eso primero para no mostrarte un diff que haya que corregir enseguida.

## `worker-supremekv1/worker.js`

```diff
     function checkAuth() {
-      return request.headers.get('x-api-key') === env.SYNC_KEY;
+      // Cloudflare Access ya verificó la sesión antes de que la solicitud llegue aqui.
+      // Si este header existe, es porque Access lo puso -- el cliente no puede falsificarlo.
+      return !!request.headers.get('Cf-Access-Authenticated-User-Email');
     }
+
+    const ROLES = {
+      // completar con los 3 correos reales -- esto lo pones tu, no va en el chat
+      // 'michelle@...': 'admin',
+      // 'luis@...': 'tecnico',
+      // 'john@...': 'tecnico',
+    };
+    function currentUser() {
+      const email = request.headers.get('Cf-Access-Authenticated-User-Email') || null;
+      return { email, role: email ? (ROLES[email] || 'tecnico') : null };
+    }
```

```diff
         if (body.wipeAll === true) {
+          if (currentUser().role !== 'admin') {
+            return new Response('Solo administradora', { status: 403, headers: cors });
+          }
           if (env.ALLOW_WIPE !== 'true') {
             return new Response('wipeAll is disabled', { status: 403, headers: cors });
           }
           ...
```

CORS necesita permitir credenciales (cookies), lo cual exige un origen exacto, no `*` — esto ya estaba propuesto antes por otra razón, ahora es obligatorio para que la cookie de Access viaje:

```diff
     const cors = {
-      'Access-Control-Allow-Origin': '*',
+      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(request.headers.get('Origin')) ? request.headers.get('Origin') : ALLOWED_ORIGINS[0],
+      'Access-Control-Allow-Credentials': 'true',
       'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
       'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
     };
```

## `index.html`

```diff
 var KV_API = 'https://supremekv1.michka1620.workers.dev/sent';
 var KV_EDITS_API = 'https://supremekv1.michka1620.workers.dev/edits';
-// Must match the SYNC_KEY secret configured on the supremekv1 Worker.
-var SYNC_KEY = '<REDACTADO>';
 
 function _syncHeaders() {
-  return { 'Content-Type': 'application/json', 'x-api-key': SYNC_KEY };
+  return { 'Content-Type': 'application/json' };
+}
+
+function _syncFetchOpts(extra) {
+  return Object.assign({ credentials: 'include' }, extra || {});
 }
```

Cada llamada a `fetch(KV_EDITS_API, {...})` necesita agregar `credentials: 'include'` (vía `_syncFetchOpts`), y el código que procesa la respuesta necesita detectar "esto no es el JSON esperado, probablemente Access pidió login" y mostrar el botón correspondiente en vez del banner genérico de error. El detalle exacto de esa detección depende de si Access devuelve un 302 (redirección HTML) o un 403 para una solicitud tipo API — eso se confirma en la prueba de staging (punto 8), no se puede afirmar sin probarlo primero.

## Retirar `?reset=1` y deshabilitar `wipeAll` desde el frontend

Igual que en el parche anterior (`docs/16_PARCHE_EMERGENCIA.md`, diff B.2) — el bloque completo de `?reset=1` se elimina de `index.html`, sin cambios respecto a esa propuesta.
