# Harness aislado: BILLING_DB.batch() con datos ficticios

Este directorio existe para un solo propósito: validar el algoritmo de
`reserve-with-batch.js` (reserva atómica de Invoice Supreme #, usando
únicamente `BILLING_DB.batch()`, sin `transaction()`/`BEGIN`/`COMMIT`/
`ROLLBACK`) contra una D1 real, antes de portarlo a `billing-db.js` en la
aplicación de verdad.

**No es parte de la aplicación.** No se despliega, no se referencia desde
el `wrangler.toml` raíz, y no toca `production` ni `supreme-autopro-pro-staging`
en ningún paso.

## Advertencias

- **Exclusivamente para la D1 ficticia `tmp-billing-batch-scratch`.** Nunca
  debe apuntar a `supreme-autopro-pro-staging` (la D1 real) ni a ninguna
  otra base que no sea esta de scratch. Si en algún momento
  `wrangler.local.toml` apunta a otro `database_id`, PARAR y confirmar
  antes de seguir.
- **Nunca ejecutar ningún comando `wrangler` de este harness sin
  `-c scratch/billing-batch-test/wrangler.local.toml`.** Sin ese flag,
  wrangler usaría el `wrangler.toml` que encuentre por default (el de la
  app real) en vez de este aislado.
- **Nunca** commitear `wrangler.local.toml` ni `.dev.vars` (ambos
  gitignorados a propósito — contienen el `database_id` real y el token de
  prueba respectivamente).
- Este Worker **no tiene autenticación real** (solo un token estático de
  `SCRATCH_TEST_TOKEN`) — por eso `wrangler dev` debe correr únicamente en
  `--ip 127.0.0.1` (nunca expuesto a la red), y nunca con `wrangler deploy`.
- Los datos son 100% ficticios (`BATCHTEST-*`, contador arrancando en
  `900000000`, muy por fuera del rango real `~202639xxx`).

## Setup (una sola vez)

1. Crear la D1 `tmp-billing-batch-scratch` desde el dashboard de Cloudflare
   (pendiente de aprobación aparte — este README no autoriza ese paso).
2. Copiar el template y completar el `database_id`:
   ```bash
   cp scratch/billing-batch-test/wrangler.example.toml scratch/billing-batch-test/wrangler.local.toml
   # editar wrangler.local.toml: reemplazar database_id
   ```
3. Generar el token local y guardarlo en `.dev.vars` (mismo directorio):
   ```bash
   cp scratch/billing-batch-test/.dev.vars.example scratch/billing-batch-test/.dev.vars
   # editar .dev.vars: reemplazar SCRATCH_TEST_TOKEN por un valor random,
   # por ejemplo: node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   ```

## Aplicar el schema (una sola vez, después del setup)

```bash
npx wrangler -c scratch/billing-batch-test/wrangler.local.toml \
  d1 execute tmp-billing-batch-scratch --remote \
  --file=sql/v001_crear_tablas_billing.sql
```

## Correr el harness

Terminal 1 (desde la raíz del repo):
```bash
npx wrangler -c scratch/billing-batch-test/wrangler.local.toml \
  dev --remote --ip 127.0.0.1
```

Terminal 2 (desde la raíz del repo):
```bash
SCRATCH_TEST_TOKEN=<mismo valor que en .dev.vars> \
  node scratch/billing-batch-test/run-concurrency-tests.mjs
```

## Validación local (sin D1, sin red) — ya corrida y en verde

```bash
node --test scratch/billing-batch-test/reserve-with-batch.local.check.js
```
Usa `d1-emulator.js` (un stand-in de la forma `.prepare().bind().batch()` de
D1 sobre `node:sqlite`) para validar la lógica SQL sin tocar la nube. No
reemplaza la prueba contra D1 real — solo la precede.

## Cómo eliminar todo al terminar

1. Dashboard de Cloudflare → D1 → `tmp-billing-batch-scratch` → Settings →
   Delete database (o `wrangler d1 delete tmp-billing-batch-scratch`).
2. Borrar `wrangler.local.toml` y `.dev.vars` localmente (o dejarlos, ya
   están gitignorados y apuntan a una base que ya no existe).
3. Ningún Worker quedó desplegado (todo corrió con `wrangler dev`), así que
   no hay nada más que borrar del lado de Cloudflare.

## Estado conocido / pendiente

El diseño de `.batch()` en `reserve-with-batch.js` está validado localmente
(7/7 contra el emulador) pero **todavía no se ejecutó contra D1 real**. Ver
los comentarios en `reserve-with-batch.js` para el detalle de por qué la
atomicidad se logra con subconsultas "vivas" en vez de un valor pasado
entre statements.
