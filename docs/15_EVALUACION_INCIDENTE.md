# Evaluación del incidente — Supreme AutoPro (2026-08-07)

## 1. Qué se confirmó

- `GET /edits` y `GET /sent` responden sin ninguna autenticación — confirmado en código y en vivo (`docs/12_SEGURIDAD_ENDPOINTS.md`).
- La clave `SYNC_KEY` que protege la escritura está en texto plano en `index.html` (línea 3952), visible con "ver código fuente" del navegador — sin necesidad de ninguna herramienta especial.
- `wipeAll` se dispara automáticamente al cargar la página con `?reset=1` en la URL (`index.html` línea 3257) — **no requiere hacer clic en nada ni conocer la clave por separado, porque la clave ya está cargada en la misma página.** Esto significa que un enlace malicioso del tipo `https://bold-mouse-3bc3.michka1620.workers.dev/?reset=1`, si alguien de Supreme AutoPro lo abre mientras tiene la app cargada, dispara el borrado sin que el atacante necesite conocer la clave — es un riesgo adicional al de "alguien copia la clave del código fuente".

## 2. Preservación de evidencia — hecha ahora

- Snapshot completo de D1: `backups/INCIDENTE_d1_snapshot_2026-08-07_0238.json` + `INCIDENTE_d1_sent_snapshot_2026-08-07_0238.json`.
- Copia exacta del Worker actual: `backups/INCIDENTE_worker_js_2026-08-07_0238.js`.
- Copia exacta de `index.html`: `backups/INCIDENTE_index_html_2026-08-07_0238.html`.
- Commit desplegado en `main`: `e84c503` (registrado con fecha/hora UTC en `backups/INCIDENTE_commit_desplegado_2026-08-07_0238.txt`).
- Checksums de todo lo anterior: `backups/INCIDENTE_CHECKSUMS_2026-08-07_0238.txt`.
- Conteos actuales: `edits: 148, deleted_keys: 39, new_invoices: 79`. (`sent_states` no se cuenta por separado porque el endpoint no expone su total como número — su archivo JSON completo sí quedó respaldado.)

Ningún dato personal se imprime en este documento — los snapshots quedan en archivos, no en el reporte.

## 3. Auditoría de posibles accesos o cambios no autorizados

**Lo que sí se pudo comprobar:**
- Comparé byte a byte el snapshot de D1 tomado hoy a las 01:28 UTC (al inicio de este sprint de integridad) contra el tomado ahora, 02:38 UTC: **son idénticos** (mismo checksum SHA-256: `824108db...`). No hubo ningún cambio en D1 durante esa ventana de ~70 minutos, ni por `wipeAll` ni por ninguna otra escritura.
- `wipeAll` claramente no se ejecutó en ningún momento reciente: las tablas siguen con datos (148/39/79), no vacías.
- Todo cambio de datos hecho hasta ahora en este proyecto está documentado en los commits de git y en los mensajes de esta conversación — no hay ninguna escritura sin explicación conocida.

**Lo que NO se puede comprobar, y por qué:**
- **No hay ningún registro de quién ha hecho `GET /edits` históricamente.** Cloudflare Workers no guarda logs de solicitudes por defecto — haría falta tener activado Cloudflare Logpush o Workers Observability desde antes, y no está configurado en este proyecto. Esto significa: **no podemos saber si alguien más, en algún momento pasado, leyó los datos** a través del endpoint público. La exposición fue real independientemente de si se comprobó que alguien la usó.
- No existe autenticación individual, así que aunque hubiera logs, no se podría atribuir una solicitud a una persona específica — solo a una IP.
- No hay una tabla de auditoría (quién cambió qué campo, cuándo) — es exactamente lo que "Usuarios"/autenticación real resolvería, y hoy no existe.

**Conclusión honesta:** no hay evidencia de que haya ocurrido un acceso indebido, pero tampoco hay forma de descartarlo con certeza para el período anterior a hoy, porque nunca existió el mecanismo para detectarlo. La exposición era real desde que se desplegó esta versión del Worker (confirmado en el propio `worker.js`) — de ahí en adelante.
