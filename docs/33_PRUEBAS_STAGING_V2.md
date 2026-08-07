# Pruebas obligatorias en staging — v2 (Access sobre toda la app)

Reemplaza `docs/30` (esa versión asumía protección solo de `/api/*`).

| # | Prueba | Resultado esperado |
|---|---|---|
| 1 | Sitio raíz sin sesión | Login de Access — nunca la app |
| 2 | `index.html` sin sesión (URL directa) | Login de Access, o acceso rechazado — nunca el HTML |
| 3 | `/api/edits` sin sesión | Rechazado |
| 4 | `/api/sent` sin sesión | Rechazado |
| 5 | JWT alterado | Rechazado — falla la firma |
| 6 | JWT expirado | Rechazado — falla `exp` |
| 7 | Audiencia incorrecta | Rechazada — falla `aud` |
| 8 | Correo falso en encabezado (enviado directo, sin pasar por Access) | Ignorado — el Worker solo confía en el email que sale del JWT ya verificado |
| 9 | `?reset=1` | No borra ni modifica nada — el bloque ya no existe |
| 10 | `wipeAll` | Inexistente o rechazado (rechazado por defecto sin `ALLOW_WIPE` + rol admin) |
| 11 | Código fuente del frontend servido | Sin ningún secreto — `SYNC_KEY` ya no existe en ningún archivo |
| 12 | Worker interno (`supremekv1-staging`) por URL pública | Inaccesible, una vez desactivada su ruta (último paso, no primero) |
| 13 | Facturas, conteos y totales | Sin cambios — verificado con `scripts/validate_staging.py` |
| 14 | Luis y John inician sesión desde Safari en iPhone real | Funciona — cookie de primera parte, sin problema de Safari |
| 15 | Michelle inicia sesión desde escritorio | Funciona |
| 16 | Cerrar sesión | Bloquea el acceso de nuevo — pide login otra vez |

Confirmado en vivo justo ahora: producción sigue igual (`GET /edits` → 302, `main` sin cambios). Nada de `docs/31` ni `docs/32` se aplicó, ninguna ruta se desactivó, ningún push a `main`.
