# Paso 2 — Copiar datos de producción a staging sin conectar ambas bases

## Principio

Ningún proceso, script ni sesión debe tener las claves de producción y staging al mismo tiempo activas en la misma operación. La copia es unidireccional y en dos etapas separadas, cada una con un solo secreto en juego:

```
Producción (GET, sin clave, solo lectura)  →  archivo JSON  →  Staging (POST, con la clave de staging, solo Michelle la tiene)
```

Claude ya hizo la primera mitad (lectura de producción, que no requiere clave): los snapshots ya están en el repo, en `backups/d1_snapshot_2026-08-07_0128.json` y `backups/d1_sent_snapshot_2026-08-07_0128.json`. Son de solo lectura — nunca tocaron producción.

## Quién ejecuta la segunda mitad

La segunda mitad (escribir en staging) la debe correr **Michelle**, desde su propia terminal o Cloudflare Console, porque requiere el `SYNC_KEY` de staging que no se comparte con Claude. Comandos exactos (reemplazar `<TU_SYNC_KEY_STAGING>` y la URL si es distinta):

```bash
curl -X POST "https://supremekv1-staging.<cuenta>.workers.dev/edits" \
  -H "Content-Type: application/json" \
  -H "x-api-key: <TU_SYNC_KEY_STAGING>" \
  --data @backups/d1_snapshot_2026-08-07_0128.json

curl -X POST "https://supremekv1-staging.<cuenta>.workers.dev/sent" \
  -H "Content-Type: application/json" \
  -H "x-api-key: <TU_SYNC_KEY_STAGING>" \
  --data @backups/d1_sent_snapshot_2026-08-07_0128.json
```

Nota: el snapshot de `/edits` viene en formato `{edits, deleted, newInvs}` tal cual lo devuelve el GET — el mismo Worker lo acepta de vuelta en el POST sin transformación, porque `edits` en el snapshot ya viene como objetos simples (no como `{diff, updatedAt}`); el Worker trata cualquier valor sin la envoltura `diff` como el diff mismo (ver `worker.js` línea ~137), así que esto funciona sin editar el archivo.

## Verificación después de copiar

```bash
curl -s "https://supremekv1-staging.<cuenta>.workers.dev/edits" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('edits:', len(d['edits']), 'deleted:', len(d['deleted']), 'newInvs:', len(d['newInvs']))
"
```

Debe mostrar exactamente lo mismo que el snapshot: **148 edits, 39 deleted, 79 newInvs**. Si Michelle comparte ese resultado (solo los números, no la clave), Claude puede confirmar que coincide con producción sin haber tocado nada él mismo.

`HISTORICAL_DATA` no necesita copiarse a ninguna base — vive en el código (`index.html`), y staging usará una copia del mismo archivo, no una base de datos aparte para eso.
