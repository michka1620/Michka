# Paso 1 — Crear staging en Cloudflare (guía exacta)

Ejecutar manualmente en el dashboard de Cloudflare. Ninguna clave se comparte en el chat.

## A. Base de datos D1
1. Workers & Pages → D1 SQL Database → **Create Database** → nombre exacto: `supreme-autopro-staging`.
2. Abrir su Console → pegar y ejecutar el contenido completo de `worker-supremekv1/schema.sql`.
3. Verificar que quedó vacía: `SELECT count(*) FROM edits;` → debe dar **0**.

## B. Worker de staging
1. Workers & Pages → Create → Worker → nombre exacto: `supremekv1-staging`.
   Cloudflare le asigna automáticamente su propia URL (`supremekv1-staging.<cuenta>.workers.dev`) — esa es la URL separada de producción, no hay paso adicional.
2. Edit code → pegar el contenido completo de `worker-supremekv1/worker.js` (idéntico al de producción) → Deploy.

## C. Binding D1 (esto aísla staging de producción)
1. Worker `supremekv1-staging` → Settings → Bindings → Add → D1 Database.
2. Nombre del binding: exactamente `SUPREME_DB` (no cambiar, así se llama en el código).
3. Base seleccionada: `supreme-autopro-staging` — confirmar visualmente que NO es la de producción.

## D. Clave secreta de staging
1. Settings → Variables and Secrets → Add → Secret.
2. Nombre: `SYNC_KEY`.
3. Valor: generado por Michelle, aleatorio, sin compartir con Claude. Evitar caracteres ambiguos (I/l/O/0/1).
4. Save and Deploy.

## Prueba de aislamiento (evidencia, no solo confianza)
1. En la Console de `supreme-autopro-staging`: `SELECT count(*) FROM edits;` → debe dar **0**. Producción tiene 148 — si staging también muestra 148, algo está mal conectado.
2. Abrir `https://supremekv1-staging.<cuenta>.workers.dev/edits` en el navegador → debe devolver `{"edits":{},"deleted":[],"newInvs":[]}`.

Cuando ambas pruebas pasen, staging está listo para el paso 2 (migración de datos).
