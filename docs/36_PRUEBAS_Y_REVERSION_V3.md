# Pruebas actualizadas y reversión — v3

## Prueba específica — el Worker interno queda inaccesible por URL pública

Después del paso "desactivar ruta pública" (staging primero, producción después siguiendo `docs/35`):

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://supremekv1-staging.michka1620.workers.dev/edits
```
Resultado esperado: **error de conexión o `530`/`404`** (Cloudflare ya no enruta nada a ese Worker por esa URL) — no un `401`/`403` con cuerpo del Worker, porque el Worker ni siquiera debería recibir la solicitud. Se corre igual contra la URL de producción, solo después de completar el paso 3 del orden de producción (`docs/35`).

## Casos de prueba completos (reemplaza `docs/33`)

| # | Prueba | Resultado esperado |
|---|---|---|
| 1 | Sitio raíz sin sesión | Login de Access |
| 2 | `index.html` sin sesión (URL directa) | Login de Access, nunca el HTML |
| 3 | `/api/edits` sin sesión | Rechazado |
| 4 | `/api/sent` sin sesión | Rechazado |
| 5 | JWT alterado | Rechazado — falla la firma |
| 6 | JWT expirado | Rechazado — falla `exp` |
| 7 | Audiencia incorrecta | Rechazada |
| 8 | Correo autenticado pero fuera de `ACCESS_ROLES_JSON` | **403** — no recibe rol técnico por defecto |
| 9 | `alg` distinto de `RS256` en el JWT | Rechazado |
| 10 | JWT sin `kid` | Rechazado |
| 11 | `payload.email` ausente o no es texto | Rechazado |
| 12 | Correo falso en header, mandado directo (mientras la ruta pública siga activa para pruebas) | Ignorado — el Worker frontal nunca reenvía headers del cliente, solo los que él mismo genera |
| 13 | `?reset=1` | No borra ni modifica nada — el bloque ya no existe |
| 14 | `POST {"wipeAll": true}` | **400**, ninguna acción destructiva, conteos de D1 intactos |
| 15 | Código fuente del frontend servido | Sin `SYNC_KEY` ni ningún secreto |
| 16 | `supremekv1`/`supremekv1-staging` por URL pública, después de desactivarla | Inaccesible (ver prueba específica arriba) |
| 17 | Facturas, conteos y totales | Sin cambios |
| 18 | Luis y John inician sesión desde Safari en iPhone real | Funciona |
| 19 | Michelle inicia sesión desde escritorio | Funciona |
| 20 | Cerrar sesión | Bloquea el acceso de nuevo |

## Plan de reversión

Sin cambios de fondo respecto a lo ya descrito — todo código nuevo se revierte con `git revert`; la Access Application y el Service Binding se desactivan desde el dashboard sin tocar D1; si hiciera falta, la ruta pública de `supremekv1` se puede reactivar temporalmente como red de emergencia mientras se revierte el resto — nunca se pierde ningún dato en ningún escenario de reversión, porque ningún paso de este parche toca D1.

## Confirmación — producción sigue intacta

Confirmado en vivo justo ahora: `GET /edits` en producción sigue devolviendo **302**. `main` sigue en `e84c503`, sin push. Nada de `docs/34`-`docs/36` se aplicó a archivos reales, ninguna dependencia instalada, ninguna ruta desactivada.
