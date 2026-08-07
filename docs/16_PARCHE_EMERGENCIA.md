# Parche de emergencia — diff propuesto (NO aplicado, NO desplegado)

## Archivos que se modificarían

- `worker-supremekv1/worker.js` — proteger `GET`, restringir CORS.
- `index.html` — retirar la clave del código fuente, cambiar `wipeAll` de automático a confirmado.

Ningún cambio de esquema, ningún cambio de datos.

## Diff 1 — `worker-supremekv1/worker.js`: proteger las lecturas

```diff
     const cors = {
-      'Access-Control-Allow-Origin': '*',
+      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(request.headers.get('Origin')) ? request.headers.get('Origin') : ALLOWED_ORIGINS[0],
       'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
       'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
     };
```
(agregar arriba del todo: `const ALLOWED_ORIGINS = ['https://bold-mouse-3bc3.michka1620.workers.dev'];` — se le sumaría la URL del frontend de staging cuando exista)

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

**`wipeAll` no necesita un cambio propio en el Worker** — ya exige `checkAuth()` en el `POST`. El problema nunca fue el Worker, fue que la clave estaba pública. Con la clave rotada y retirada del frontend (diff 2), `wipeAll` vuelve a estar realmente protegido.

## Diff 2 — `index.html`: retirar la clave del código fuente

```diff
 var KV_API = 'https://supremekv1.michka1620.workers.dev/sent';
 var KV_EDITS_API = 'https://supremekv1.michka1620.workers.dev/edits';
-// Must match the SYNC_KEY secret configured on the supremekv1 Worker.
-var SYNC_KEY = 'NjqjcbvNyuhTSJHcqDJRJS4d4Jns8xpY';
 
 function _syncHeaders() {
-  return { 'Content-Type': 'application/json', 'x-api-key': SYNC_KEY };
+  return { 'Content-Type': 'application/json', 'x-api-key': localStorage.getItem('sup_sync_key') || '' };
+}
+
+function saveSyncKey() {
+  var key = document.getElementById('sync-key-input').value.trim();
+  if (!key) { showToast('Ingresa la clave de sincronizacion'); return; }
+  localStorage.setItem('sup_sync_key', key);
+  showToast('Clave guardada en este dispositivo');
 }
```

Mismo patrón que ya existe hoy para la clave de Anthropic (`localStorage.getItem('anthropic_api_key')`, `index.html` líneas 2403-2410) — no es una idea nueva, es reutilizar algo que ya funciona en esta misma app.

Falta además: (a) un campo de texto en la pantalla de configuración para pegar la clave (como ya existe para la de Anthropic), y (b) agregar `headers: _syncHeaders()` a las 2 llamadas `fetch` de lectura que hoy no mandan ningún header (`pullEditsFromKV`, y la lectura de `/sent` si aplica) — hoy el `GET` no manda headers porque nunca los necesitó.

## Diff 3 — `index.html`: `wipeAll` deja de dispararse solo

```diff
   if (location.search.indexOf('reset=1') >= 0) {
-    localStorage.removeItem('sup_edits');
-    ...
-    fetch('https://supremekv1.michka1620.workers.dev/edits', {method:'POST',headers:_syncHeaders(),body:JSON.stringify({wipeAll:true})}).catch(function(){});
-    history.replaceState(null,'',location.pathname);
+    if (confirm('Esto borra TODOS los datos del servidor para todos los dispositivos. Esta accion no se puede deshacer desde aqui. Escribe SI en el proximo cuadro para confirmar.')) {
+      var typed = prompt('Escribe BORRAR TODO para confirmar:');
+      if (typed === 'BORRAR TODO') {
+        localStorage.removeItem('sup_edits');
+        ...
+        fetch('https://supremekv1.michka1620.workers.dev/edits', {method:'POST',headers:_syncHeaders(),body:JSON.stringify({wipeAll:true})}).catch(function(){});
+      }
+    }
+    history.replaceState(null,'',location.pathname);
   }
```

Esto cierra el segundo riesgo que encontré: hoy, un enlace `.../?reset=1` compartido con cualquiera de ustedes dispara el borrado **sin que quien envía el enlace necesite conocer la clave**, porque la clave ya vive en la página que la víctima tiene abierta. Con esto, hace falta una confirmación explícita y deliberada, no solo abrir un link.

## Funciones temporalmente deshabilitadas mientras se aplica el parche

- **La sincronización entre dispositivos se detiene** hasta que cada persona (Michelle, Luis, John) entre la nueva clave una vez en su navegador. Mientras tanto, la app sigue funcionando localmente (se puede seguir viendo/editando en ese dispositivo), pero no sube ni baja cambios del servidor — exactamente el escenario que dijiste que aceptas.
- La barra de estado ya existente (`showPendingBanner`) mostraría el estado de error de conexión que ya está construido (`❌ Sin conexión al servidor de datos`) — no hace falta construir nada nuevo para esa parte, ya estaba ahí.
- El botón "Procesar fotos" (extracción con IA) no se ve afectado — usa una clave distinta (`anthropic_api_key`), ya guardada por separado en cada dispositivo.

## Revisión de `wipeAll`

- **Ruta exacta:** `POST /edits` (mismo endpoint que cualquier edición, no una ruta separada), con cuerpo `{"wipeAll": true}`. También existe `POST /sent` con su propio `{"wipeAll": true}`.
- **Método HTTP:** POST.
- **Autenticación actual:** `checkAuth()` — la misma `SYNC_KEY` de cualquier escritura. Nunca fue un endpoint sin protección; el problema fue que la clave que lo protege era pública.
- **Quién puede llamarlo hoy:** cualquiera que tenga la clave — que, hasta que se aplique este parche, es cualquiera que haya visto el código fuente de la página.
- **Desde dónde se usa en el frontend:** un único lugar, `index.html` línea 3257, disparado automáticamente al visitar la URL con `?reset=1`.
- **¿Es necesario conservarlo?** Sí — es el mecanismo de recuperación de emergencia ya usado antes en este proyecto (evacuar datos corruptos). No se propone eliminarlo, solo protegerlo mejor (diff 3) y, a futuro, restringirlo al rol de administradora una vez exista autenticación real.

## Casos de prueba (a correr primero en staging, no en producción)

1. `GET /edits` sin `x-api-key` → esperado `401`.
2. `GET /sent` sin `x-api-key` → esperado `401`.
3. `POST /edits` sin `x-api-key` → esperado `401` (ya es el comportamiento actual, se re-confirma que sigue igual).
4. Visitar `?reset=1` sin confirmar el `prompt` → no debe llamar a `wipeAll`.
5. `GET /edits` con la clave correcta → devuelve los datos esperados, sin cambios respecto a hoy.
6. Antes/después del parche: los 8 checks de conteos y totales (`scripts/validate_staging.py`) deben dar exactamente igual — el parche es solo de acceso, no debe mover ningún dato.
7. Ninguna factura desaparece — comparar conteo de facturas antes/después.
8. Buscar en el `index.html` desplegado (ver código fuente) que no exista ningún string que se parezca a una clave.
9. Las respuestas de error (401) no deben incluir la clave ni ningún dato de facturas en el cuerpo.
10. Reversión: revertir el commit del parche y confirmar que el comportamiento (y los checksums de `worker.js`/`index.html`) vuelven a ser exactamente los de antes del parche.

## Plan de reversión

Todo el parche es un cambio de código, sin tocar datos ni esquema — revertir es `git revert` del commit del parche (frontend y backend por separado, ya que se despliegan por separado). Si el Worker ya se desplegó y hay que revertirlo, se vuelve a pegar el código anterior (guardado en `backups/INCIDENTE_worker_js_2026-08-07_0238.js`) en el dashboard de Cloudflare. Ningún dato se pierde en ningún sentido de la reversión, porque el parche nunca los toca.
