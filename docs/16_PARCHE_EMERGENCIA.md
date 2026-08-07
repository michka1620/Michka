# Parche de emergencia — diff exacto, redactado (NO aplicado, NO desplegado)

Reemplaza la versión anterior de este documento: corregido según tus 3 exigencias — sin ningún mecanismo de clave compartida en el frontend (ni siquiera en `localStorage`), `wipeAll` deshabilitado por defecto en el servidor (no solo con confirmación en el navegador), y mensaje explícito de mantenimiento en vez de fallo silencioso.

Ningún valor real de clave aparece en este documento — se usa `<REDACTADO>` donde corresponde.

---

## Diff A — `worker-supremekv1/worker.js`

### A.1 — CORS: restringir orígenes (no reemplaza autenticación, ver nota abajo)

```diff
     const cors = {
-      'Access-Control-Allow-Origin': '*',
+      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(request.headers.get('Origin')) ? request.headers.get('Origin') : ALLOWED_ORIGINS[0],
       'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
       'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
     };
```
(agregar antes: `const ALLOWED_ORIGINS = ['https://bold-mouse-3bc3.michka1620.workers.dev'];`)

**Qué hace:** limita qué sitios web pueden hacer llamadas *desde el navegador de una víctima* usando su sesión. **Qué NO hace:** no detiene una llamada directa por `curl`/script — CORS lo aplica el navegador, no el servidor. Por eso este cambio nunca cuenta como protección por sí solo; solo reduce el riesgo de un sitio externo abusando de un navegador ya logueado.

### A.2 — Exigir autenticación también en `GET /edits` y `GET /sent`

```diff
     if (url.pathname === '/edits') {
       if (request.method === 'GET') {
+        if (!checkAuth()) return new Response('Unauthorized', { status: 401, headers: cors });
         const [editRows, delRows, newRows] = await Promise.all([
```
```diff
     if (url.pathname === '/sent') {
       if (request.method === 'GET') {
+        if (!checkAuth()) return new Response('Unauthorized', { status: 401, headers: cors });
         const rows = await env.SUPREME_DB.prepare('SELECT key, state FROM sent_states').all();
```

**Qué hace:** cierra la lectura pública. Cualquier solicitud sin el header `x-api-key` correcto recibe `401` sin ver ningún dato.

### A.3 — `wipeAll` deshabilitado por defecto en el servidor (no solo en el navegador)

```diff
         if (body.wipeAll === true) {
+          if (env.ALLOW_WIPE !== 'true') {
+            return new Response('wipeAll is disabled', { status: 403, headers: cors });
+          }
           await env.SUPREME_DB.batch([
             env.SUPREME_DB.prepare('DELETE FROM edits'),
             env.SUPREME_DB.prepare('DELETE FROM deleted_keys'),
             env.SUPREME_DB.prepare('DELETE FROM new_invoices'),
           ]);
           return json({ status: 'ok', wiped: true });
         }
```
(mismo bloque en `/sent`, con su propio `body.wipeAll`)

**Qué hace:** aunque alguien tenga la clave `SYNC_KEY` correcta, `wipeAll` responde `403` a menos que exista además la variable de entorno `ALLOW_WIPE` puesta en `"true"` — algo que **tú** tendrías que activar manualmente en el dashboard de Cloudflare, a propósito, justo antes de una restauración administrativa verificada, y quitar después. Es la "acción administrativa explícita en el servidor" que pediste. `ALLOW_WIPE` no existe hoy — quedaría sin definir, es decir, deshabilitado por defecto, sin que tengas que hacer nada extra ahora.

**Limitación honesta:** este parche no agrega una tabla de registro/auditoría de cuándo se usó `wipeAll` — eso requeriría un cambio de esquema, que excluiste explícitamente de este parche ("no cambiar datos, tablas ni facturas"). Queda pendiente para cuando se implemente la arquitectura de auditoría completa (`docs/18`).

---

## Diff B — `index.html`

### B.1 — Retirar la clave por completo, sin reemplazarla por ningún mecanismo de clave compartida

```diff
 var KV_API = 'https://supremekv1.michka1620.workers.dev/sent';
 var KV_EDITS_API = 'https://supremekv1.michka1620.workers.dev/edits';
-// Must match the SYNC_KEY secret configured on the supremekv1 Worker.
-var SYNC_KEY = '<REDACTADO>';
 
 function _syncHeaders() {
-  return { 'Content-Type': 'application/json', 'x-api-key': SYNC_KEY };
+  return { 'Content-Type': 'application/json' };
 }
```

**Qué hace:** el frontend deja de tener cualquier forma de enviar una clave — ni incrustada, ni en `localStorage`, ni pedida al usuario. Corregido según tu punto 4: no se agrega ningún campo para pegar una clave nueva. Toda sincronización (lectura y escritura) recibirá `401` del Worker parchado hasta que exista autenticación real por usuario — que es exactamente lo que pediste.

### B.2 — Retirar por completo `?reset=1` → `wipeAll` del frontend

```diff
-  // Clear local edits and KV if ?reset=1 in URL
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

**Qué hace:** ningún enlace, con o sin `?reset=1`, puede disparar nada destructivo desde el navegador — el bloque entero desaparece. `?clearpending=1` (que ya existe, y nunca toca el servidor) sigue siendo la forma segura de limpiar el caché de un dispositivo si hace falta.

### B.3 — Mensaje explícito, no falla silenciosa

```diff
 function showPendingBanner(pendingCount) {
   ...
-  // (estado 'error' actual: "❌ Sin conexión al servidor de datos")
+  // (estado 'error', mientras dure el mantenimiento de seguridad)
+  banner.textContent = '🔧 Sincronización temporalmente deshabilitada por mantenimiento de seguridad. Los datos locales no se han eliminado.';
```

**Qué hace:** en vez del mensaje genérico de "sin conexión", el usuario ve exactamente el texto que pediste, dejando claro que no hay pérdida de datos.

---

## Resumen de qué protege cada pieza

| Pieza | Protege contra |
|---|---|
| A.2 (auth en GET) | Lectura pública de datos de clientes/facturas |
| A.3 (`ALLOW_WIPE`) | Borrado total, incluso con la clave correcta en manos equivocadas |
| B.1 (sin clave en frontend) | Que exista siquiera un secreto que copiar del código fuente |
| B.2 (retirar `?reset=1`) | Que un enlace, sin que nadie conozca ninguna clave, dispare un borrado |
| A.1 (CORS) | Un sitio externo abusando de un navegador ya logueado — **complementario, no sustituye nada de lo anterior** |
