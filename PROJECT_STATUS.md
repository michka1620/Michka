# Estado del proyecto — pro-staging-import

Rama de trabajo: `pro-staging-import`. Nunca `main` ni `production`.
`production` (`origin/production`) no se toca en ningún paso de este documento.

## Completado

1. **Corte semanal inclusivo con precisión de milisegundo** (`bloque-semanal.js`)
   — `toChicagoParts` no capturaba segundos/milisegundos, así que el corte
   de las 12:00pm del miércoles era en realidad "cualquier momento dentro
   de ese minuto", no el instante exacto. Corregido para exigir
   estrictamente `> 12:00:00.000` para pasar al bloque siguiente.
2. **Fixes reales en `worker.js`**:
   - `/favicon.ico` lanzaba `TypeError` (`new Response("", {status:204})`
     no es válido) → corregido a `new Response(null, {status:204})`.
   - `proxyToSupremekv` lanzaba `RequestInit: duplex option is required`
     al proxear requests con body → agregado `duplex:"half"` solo cuando
     corresponde.
3. **`worker.test.js`** (13 pruebas nuevas) — regresión end-to-end del
   `fetch` handler real: favicon, auth faltante, config faltante, caché
   HTML/binaria, GET/POST admin, POST prohibido técnico, GET filtrado
   técnico, proxy `/api/*`, `/api/servicios`, vision con/sin secreto.
4. **`scripts/scan-repository-secrets.mjs`** (standalone, no conectado al
   deploy) — escanea archivos trackeados por git buscando patrones de
   claves/secretos comunes.
5. **`scripts/check-cloudflare-secrets.mjs`** (standalone, no conectado al
   deploy) — verifica por nombre que los secretos requeridos
   (`ACCESS_ROLES_JSON`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`,
   `ANTHROPIC_API_KEY`) estén configurados en Cloudflare vía
   `wrangler secret list`; soporta `--simulate` para probarlo sin sesión
   de Cloudflare. Nunca imprime valores.
6. **`.gitignore`**: permite `sql/*.sql` sin `git add -f`; ignora
   específicamente `scratch/billing-batch-test/wrangler.local.toml`,
   `.dev.vars` y `results/` (nunca la carpeta `scratch/` entera).
7. **Harness aislado `scratch/billing-batch-test/`** para validar
   `BILLING_DB.batch()` con datos ficticios antes de tocar la D1 real:
   - `reserve-with-batch.js`: algoritmo de reserva usando SOLO `.batch()`
     (sin `transaction()`/`BEGIN`/`COMMIT`/`ROLLBACK`), vía subconsultas
     "vivas" en vez de pasar resultados entre statements.
   - `reset-fixtures.js`: limpia y reinicializa el contador en
     `900000000` antes de cada escenario.
   - `worker.js` de prueba: solo `/reset`, `/reserve`, `/state`, sin auth
     real de la app — protegido por `SCRATCH_TEST_TOKEN` (constant-time
     compare), exigido en las 3 rutas.
   - `d1-emulator.js` + `reserve-with-batch.local.check.js`: validación
     LOCAL (node:sqlite, sin red) del diseño de `.batch()` — 7/7 en verde.
   - `run-concurrency-tests.mjs`: 3 escenarios listos para correr contra
     D1 real (mismo wo concurrente, wos distintos concurrentes, reintentos
     secuenciales) — **todavía no ejecutados**, requieren la D1 real.
   - `wrangler.example.toml` (versionado, sin `database_id` real) +
     `wrangler.local.toml`/`.dev.vars` (gitignorados, con los valores
     reales cuando existan).
   - `README.md` con advertencias, setup y procedimiento de limpieza.

## Pruebas

- Suite oficial (raíz del repo, `node --test`): **79/79** ✅
  (`billing-db.test.js`, `bloque-semanal.test.js`, `worker-lib.test.js`,
  `worker.test.js`)
- Harness de scratch (`node --test scratch/billing-batch-test/reserve-with-batch.local.check.js`):
  **7/7** ✅ — corre por separado, no se mezcla con la suite oficial.
- Escáner de secretos (`node scripts/scan-repository-secrets.mjs`): sin
  coincidencias sobre los archivos trackeados actuales.

## Commits en pro-staging-import (sobre la base 5cb9b48)

```
f8a67d1 Add isolated D1 batch concurrency test harness
d2a3ce3 Add Worker regression tests and deployment safety checks
c1d1ff9 Fix inclusive weekly cutoff with millisecond precision
```

Todos pusheados. `origin/pro-staging-import` = `HEAD` = `f8a67d1b43d92af5ad59955dbd08490113705005`.

## Pendiente (requiere autorización explícita antes de avanzar)

- Crear la D1 real `tmp-billing-batch-scratch` en Cloudflare.
- Completar `database_id` en `wrangler.local.toml` y el token real en
  `.dev.vars` (ambos locales, nunca commiteados).
- Aplicar el schema (`wrangler d1 execute ... --remote`).
- Correr `wrangler dev --remote` + `run-concurrency-tests.mjs` contra la
  D1 real para validar `.batch()` bajo concurrencia real (no solo
  emulada).
- Con eso validado: portar el algoritmo (o una versión ajustada) a
  `billing-db.js`/`worker.js` reales.
- Eliminar la D1 de scratch al terminar (`wrangler d1 delete ...`).

## Siguiente paso

Detenido antes de crear la D1 temporal — necesita tu autorización
explícita (es una acción en Cloudflare). El resto del trabajo local
(lectura/edición de archivos, pruebas, commits, push normal a
`pro-staging-import`) sigue de forma autónoma según lo acordado.
