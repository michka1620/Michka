# 7. Pruebas obligatorias en staging (a ejecutar antes de tocar producción)

| # | Prueba | Resultado esperado |
|---|---|---|
| 1 | Abrir la app sin sesión | Carga normal (historial visible); al sincronizar, pide login de Access |
| 2 | Michelle inicia sesión | Puede usar funciones de administración (`wipeAll` con `ALLOW_WIPE`, etc.) |
| 3 | Luis inicia sesión | No puede ver finanzas ni ejecutar administración (`docs/27`) |
| 4 | John inicia sesión | No puede ver finanzas ni datos de Luis (filtro por `tech.name`, `docs/27`) |
| 5 | `GET /api/edits` sin sesión | Rechazado antes de llegar al Worker (Access) |
| 6 | Header de correo falso (`X-Verified-Email` inventado directo a `supremekv1`, si su ruta pública sigue activa durante la prueba) | Ignorado/irrelevante una vez desactivada la ruta pública; mientras siga activa como red de seguridad, debe fallar por no venir del binding |
| 7 | JWT alterado (un carácter cambiado en la firma) | Rechazado — falla la verificación de firma |
| 8 | JWT expirado | Rechazado — falla el chequeo de `exp` |
| 9 | Audiencia incorrecta (JWT de otra Access Application) | Rechazada — falla el chequeo de `aud` |
| 10 | `wipeAll` | Rechazado sin `ALLOW_WIPE=true` Y sin rol admin — dos condiciones, ambas deben cumplirse |
| 11 | `?reset=1` en la URL | No produce ninguna acción — el bloque ya no existe en el código |
| 12 | Acceder a la URL pública de `supremekv1` directamente (mientras siga activa) | Debe rechazar cualquier solicitud que no traiga los headers que solo `bold-mouse-3bc3` genera |
| 13 | Facturas y totales antes/después del despliegue en staging | Sin cambios — verificado con `scripts/validate_staging.py` |
| 14 | Prueba real en Safari de iPhone | Checklist completo de `docs/23`, punto 8 — requiere un dispositivo real, no se puede simular desde este entorno |

## Confirmación — producción sigue intacta

Confirmado en vivo justo ahora: `GET /edits` en producción sigue devolviendo **302** (Access activo). `main` sigue en el commit `e84c503`, sin ningún push. Nada de lo diseñado en `docs/25` a `docs/30` se aplicó ni se desplegó — ninguna dependencia instalada, ninguna ruta desactivada.
