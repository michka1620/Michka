# Procedimiento de restauración — Supreme AutoPro

Generado: 2026-08-07. Cubre dos escenarios: restaurar la base de datos (D1) y restaurar el código/histórico (`index.html`).

## A. Restaurar D1 (edits / deleted_keys / new_invoices / sent_states) desde un snapshot

Usar cuando: una migración o un push accidental corrompe o borra datos en D1.

1. Localizar el snapshot más reciente en `backups/d1_snapshot_<fecha>.json` (y su par `d1_sent_snapshot_<fecha>.json`).
2. Vaciar las tablas actuales (SOLO si se confirmó que están corruptas, nunca como primer paso):
   ```
   POST /edits   { "wipeAll": true }
   POST /sent    { "wipeAll": true }
   ```
3. Repoblar desde el snapshot, tal cual, sin modificar valores:
   ```
   POST /edits   { "edits": <snapshot.edits envuelto en {diff, updatedAt}>, "deleted": <snapshot.deleted>, "newInvs": <snapshot.newInvs con _updatedAt> }
   POST /sent    <snapshot de /sent>
   ```
4. Verificar con `GET /edits` que los conteos (edits, deleted, newInvs) coinciden exactamente con el snapshot.
5. Recalcular los 6 números de control (facturas, facturado, cobrado, pendiente, clientes, técnicos) y compararlos contra `conteo_verificacion_<fecha>.json` del mismo snapshot.

**No se necesita vaciar D1 para restaurar registros puntuales** — un `edits`/`newInvs` con solo las claves afectadas hace upsert por fila sin tocar el resto (así se hicieron todas las correcciones de esta semana).

## B. Restaurar `HISTORICAL_DATA` / `index.html`

Usar cuando: un merge o edición manual daña los 632 registros base incrustados en el código.

1. Localizar el backup íntegro más reciente: `backups/PRODUCCION_REAL_index_<fecha>.html` (copia exacta del archivo desplegado) o `backups/index_html_snapshot_<fecha>.html` (copia de esta rama de trabajo).
2. Confirmar cuál de los dos corresponde al estado bueno conocido (comparar fecha vs. cuándo ocurrió el daño).
3. Restaurar con git, nunca sobrescribiendo a mano:
   ```
   git checkout <commit-de-respaldo> -- index.html
   git commit -m "Restore index.html from backup <fecha>"
   ```
   o, si se prefiere restaurar desde la rama de respaldo completa:
   ```
   git checkout backup/pre-staging-<fecha> -- index.html
   ```
4. Verificar localmente (`grep -c '"number"' index.html` o cargando el archivo) que el conteo de `HISTORICAL_DATA` coincide con el backup.
5. Solo entonces hacer push a `main` para que se redespliegue.

## C. Restaurar el Worker de backend (`supremekv1`)

Usar cuando: un despliegue manual desde el dashboard de Cloudflare introduce un bug.

1. La fuente de verdad versionada está en `worker-supremekv1/worker.js` en este repo (no en el dashboard).
2. Copiar el contenido de la versión buena conocida (por commit de git) y pegarlo en el dashboard de Cloudflare → Workers & Pages → `supremekv1` → Edit code → Deploy.
3. Verificar que el secreto `SYNC_KEY` sigue configurado después del deploy (se ha visto que a veces se desconecta al editar código — hay que revisar Settings → Variables antes de dar por terminada la restauración).
4. Probar con una lectura (`GET /edits`) y una escritura de prueba antes de considerar restaurado.

## Restauración probada en staging

Antes de aplicar cualquiera de estos procedimientos en producción, se prueba primero contra el entorno de staging (D1 y Worker independientes) para confirmar que el procedimiento funciona sin sorpresas. Ver sección "Staging" del reporte principal para los nombres de los recursos.
