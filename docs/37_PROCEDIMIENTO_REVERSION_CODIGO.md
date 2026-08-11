# Procedimiento de reversión del código (staging/access-auth)

Documentación únicamente. Nada de esto se ha ejecutado.

## 1. Commit actual de staging

```
09b5ba5  Remove temporary /whoami-debug diagnostic route
```

Rama: `staging/access-auth` (empujada a `origin/staging/access-auth`).

## 2. Último commit conocido como estable

```
5d457d9  Harden the Access/JWT design per third review pass
```

Es el commit **inmediatamente anterior** a que empezara a tocarse código funcional.
Todo lo anterior a este punto en la rama es documentación de diseño (`docs/*.md`),
nunca aplicada ni desplegada. El primer commit que sí cambia código es el
siguiente (`d580ca0`), que es el que la reversión deshace junto con todo lo
posterior.

## 3. Comando exacto para revertir únicamente los cambios de staging

```bash
git checkout staging/access-auth
git revert --no-commit 5d457d9..09b5ba5
git commit -m "Revert Cloudflare Access + Service Binding staging changes"
git push origin staging/access-auth
```

Alternativa (reset en vez de revert, si se prefiere no dejar rastro de los
commits revertidos -- menos recomendable porque reescribe historia ya
publicada):

```bash
git checkout staging/access-auth
git reset --hard 5d457d9
git push --force-with-lease origin staging/access-auth
```

**Recomendado: `git revert`, no `git reset --hard`** -- conserva el historial
completo (incluida la investigación de esta sesión) y es más seguro sobre una
rama ya empujada a `origin`.

Este comando **nunca toca `main`** ni `wrangler.toml` (producción) -- opera
exclusivamente sobre `staging/access-auth` y `wrangler.staging.toml`.

## 4. Qué archivos volverían atrás

| Archivo | Cambio revertido |
|---|---|
| `_worker.js` | Se elimina por completo (no existía antes de `d580ca0`) |
| `wrangler.staging.toml` | Se elimina por completo (no existía antes) |
| `.github/workflows/deploy-staging.yml` | Se elimina por completo (no existía antes) |
| `index.html` | Vuelve el `SYNC_KEY` embebido, `KV_API`/`KV_EDITS_API` absolutos a producción, el bloque `?reset=1`→`wipeAll`, y la pantalla de password propia (`supreme2026`) |
| `worker-supremekv1/worker.js` | `checkAuth()` vuelve a comparar contra `SYNC_KEY` en vez de `X-Verified-Email`; reaparece el manejo de `wipeAll` anterior; `GET /edits` y `GET /sent` vuelven a quedar sin autenticación |

## 5. Qué NO cambiaría ese comando

- **`wrangler.toml`** (producción) -- no aparece en el diff, cero líneas tocadas.
- **`main`** -- la reversión ocurre enteramente dentro de `staging/access-auth`; no se hace merge ni push a `main`.
- **Cualquier archivo de `docs/`** -- toda la documentación de diseño permanece intacta como registro histórico.
- **`backups/`**, `schema.sql`, `scripts/validate_staging.py` -- no forman parte de este diff, no se tocan.

## 6. Confirmación: D1, Access, bindings y secretos no se modificarían

Un `git revert`/`git commit`/`git push` **solo cambia archivos dentro del repositorio**.
No hay ningún paso de este procedimiento que llame a la API de Cloudflare, al
dashboard, ni a D1 directamente. En concreto:

- **D1 (`supreme-autopro-staging`)**: sus tablas y filas no se tocan -- ningún
  comando de este procedimiento ejecuta SQL.
- **Cloudflare Access** (la Application "Supreme AutoPro - Staging", su
  política, el AUD tag): configurado enteramente por el dashboard, fuera del
  repositorio. Revertir el código no lo desactiva ni lo modifica.
- **Bindings** (Service Binding `SUPREMEKV`, binding D1 `SUPREME_DB`,
  binding de assets `ASSETS`): viven en la configuración de cada Worker en
  Cloudflare. Revertir el código *sin volver a desplegar* no los toca. Si
  además se hiciera un `wrangler deploy` después del revert, el binding de
  D1 (`SUPREME_DB`) seguiría intacto porque no depende de `wrangler.staging.toml`
  (ese archivo desaparecería por completo con el revert, así que ya ni se
  usaría para desplegar -- habría que decidir aparte cómo desplegar el
  `_worker.js` viejo, si es que se llega a ese punto).
- **Secretos** (`ACCESS_ROLES_JSON` como Secret en el dashboard de
  `bold-mouse-3bc3-staging`): nunca estuvo en el repositorio, así que un
  `git revert` no puede tocarlo. Seguiría existiendo en el dashboard aunque
  el código ya no lo lea.

En resumen: revertir el código dejaría la configuración de Cloudflare
(Access, bindings, secretos, D1) exactamente como está ahora, simplemente
sin que el código nuevo la use -- hasta que alguien decida desplegar el
código revertido, lo cual es un paso aparte y explícito.

## 7. Cómo verificar después que la reversión funcionó

1. `git log --oneline -1 staging/access-auth` debe mostrar el nuevo commit de
   revert como HEAD.
2. `git diff 5d457d9 staging/access-auth -- index.html _worker.js worker-supremekv1/worker.js wrangler.staging.toml .github/workflows/deploy-staging.yml`
   debe salir vacío (sin diferencias) -- confirma que el contenido volvió
   exactamente al estado de `5d457d9`.
3. `ls _worker.js wrangler.staging.toml` deben fallar con "No such file or
   directory" (ambos archivos no existían en `5d457d9`).
4. Si en algún momento se vuelve a desplegar tras el revert: repetir el
   conteo y checksums de invoices en D1 (como en la auditoría original) para
   confirmar que ninguna fila cambió -- exactamente igual que se hizo al
   verificar el incidente original.

## Estado actual

Nada de este procedimiento se ha ejecutado. Es documentación de la "salida
de emergencia", verificada por análisis del historial de git, no por
ejecución real.
