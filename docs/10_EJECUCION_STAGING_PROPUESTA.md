# Paquete de ejecución — SOLO staging (pendiente de tu aprobación final)

Nada de esto se ha ejecutado. Frase de aprobación esperada: *"Apruebo el diff y autorizo la ejecución únicamente en staging."*

## 1. Diff exacto de `index.html`

Ver `08_CODE_CHANGE_PROPOSAL.md` — sin cambios desde la última revisión. Recordatorio: para esta prueba se aplica el mismo parche en los dos lugares (`getInvoices()` y `pullEditsFromKV()`) de forma **temporal** — después de validar en staging, la propuesta de unificarlas en una sola función compartida se entrega aparte, sin implementar (sección 7).

**Importante: este diff no se aplica todavía a ningún `index.html` real, ni siquiera de staging.** El punto 4 de abajo explica por qué no hace falta tocar código para la prueba de datos — se puede verificar la lógica corregida en Python primero (ya hecho, ver más abajo), y el código real solo se toca cuando confirmes explícitamente ese paso por separado.

## 2. Los 3 registros que recibirán cuarentena

Archivo exacto a enviar: `backups/staging_quarantine_edits_payload.json` (ya generado, en el repo). Contenido — solo campos aditivos, cero campos originales tocados:

| Clave (`number|wo`) | Cliente/monto originales (sin tocar) | Campo nuevo |
|---|---|---|
| `4920134821\|202609555` | $736.50, PENDING, sin cliente | `dataIntegrity: "QUARANTINED"` + motivo |
| `4920135137\|202609556` | $372.50, PENDING, sin cliente | `dataIntegrity: "QUARANTINED"` + motivo |
| `4920135629\|202609557` | $159.00, PENDING, sin cliente | `dataIntegrity: "QUARANTINED"` + motivo |

Verificado justo ahora contra el archivo real (no una copia aparte): los 3 montos y estados originales quedan exactamente iguales, solo se les agregan los 2 campos nuevos.

## 3. Forma exacta en que se cargarían en staging

Comando exacto (lo ejecutas tú, con tu clave — Claude no la tiene ni la pide):

```bash
curl -X POST "https://supremekv1-staging.michka1620.workers.dev/edits" \
  -H "Content-Type: application/json" \
  -H "x-api-key: <TU_SYNC_KEY_STAGING>" \
  --data @backups/staging_quarantine_edits_payload.json
```

Esto solo agrega 3 entradas a la tabla `edits` de staging — no toca `deleted_keys` ni `new_invoices`, no usa `wipeAll`.

## 4. Procedimiento de reversión (ya probado en Python, sin tocar staging)

Probé el "antes/después/revertido" completo de forma offline: aplicar el payload → confirma 3 en cuarentena; simular una reversión (recargar desde el snapshot original, sin el payload de cuarentena) → confirma 0 registros en cuarentena y el total histórico vuelve exacto a 632, idéntico al estado original. En vivo, la reversión en staging sería:

```bash
curl -X POST "https://supremekv1-staging.michka1620.workers.dev/edits" \
  -H "Content-Type: application/json" \
  -H "x-api-key: <TU_SYNC_KEY_STAGING>" \
  --data '{"wipeAll": true}'
# luego repoblar desde los snapshots originales (docs/02_STAGING_DATA_MIGRATION_PLAN.md)
```

Como staging es descartable, esta es la reversión más segura: nunca depende de "deshacer" un campo con otro POST (el mecanismo de merge actual protege campos no vacíos, así que "borrar" un campo con un valor vacío no funciona de forma confiable) — se reinicia limpio desde el snapshot que nunca se toca.

## 5. Conteos esperados (confirmados ahora con el payload JSON real, no solo la simulación)

| Métrica | Antes | Después |
|---|---|---|
| Total físico | 632 | **634** |
| Activos | 629 (sin contar los 2 ocultos) | **631** |
| Cuarentena | 0 | **3** |
| Facturado (activos) | $149,692.99 | **$148,956.49** |
| Cobrado | $129,574.57 | **$129,574.57** (sin cambio) |
| Pendiente | $20,118.42 | **$19,381.92** |
| Clientes únicos | 251 | **252** |

## 6. Confirmación — el endpoint apunta únicamente a staging

El comando del punto 3 usa `supremekv1-staging.michka1620.workers.dev` — Worker y base de datos distintos a producción (`supremekv1.michka1620.workers.dev`). Claude no tiene la clave de staging ni la de producción para escritura, así que no puede ejecutar esto por accidente contra ningún lado — lo ejecutas tú, copiando el comando tal cual, contra la URL que ya verificaste que existe.

## 7. Pendiente para después de validar staging (no ahora)

Propuesta de función única compartida para reemplazar las 2 copias de la lógica de deduplicación — se entrega aparte, después de que confirmes que la prueba en staging salió como se esperaba. Sin implementar todavía.

---

Esperando: *"Apruebo el diff y autorizo la ejecución únicamente en staging."*
