# Efectos del parche + orden de despliegue + pruebas

## Qué deja de funcionar mientras no exista autenticación real

- **La sincronización automática deja de funcionar** — tanto traer datos del servidor como enviar cambios. Confirmado: sí.
- **Las facturas históricas (632 registros de `HISTORICAL_DATA`) se siguen viendo sin ningún problema** — viven dentro del propio archivo `index.html`, nunca dependen de la red. Nadie deja de ver el historial.
- **Se pueden seguir creando y editando facturas — solo de forma local.** El mecanismo que guarda en `localStorage` (`sup_edits`, `sup_new`, etc.) no cambia con este parche — sigue funcionando exactamente igual, device por device.
- **Las ediciones quedan en `localStorage`** de cada dispositivo, marcadas como pendientes de sincronizar (`sup_sync_pending`), tal como ya pasa hoy cuando un dispositivo pierde conexión — este parche no inventa ese mecanismo, ya existe y ya está probado (es el mismo que resolvió el bug de sincronización de esta semana).
- **Mensaje que vería el usuario:** el texto exacto que pediste, vía el cambio B.3 del diff — "🔧 Sincronización temporalmente deshabilitada por mantenimiento de seguridad. Los datos locales no se han eliminado."

## Riesgo de sobrescribir datos al reactivar la sincronización

Bajo, por diseño ya existente: cuando se reactive (con autenticación real), cada dispositivo que acumuló cambios locales durante el apagón los sube como "pendientes" — el mismo mecanismo de `pullEditsFromKV()` que ya prioriza cambios locales no confirmados sobre el estado del servidor hasta que se confirme la subida. No es un mecanismo nuevo que haya que construir para este parche.

## Orden de despliegue

Tu orden es el correcto — coincido, con una sola advertencia:

1. Snapshot final.
2. Verificar conteos.
3. Desplegar el Worker parchado (A.1-A.3).
4. Rotar la clave de producción inmediatamente.
5. Verificar que la clave antigua ya no funciona.
6. Probar que los `GET` públicos devuelven 401.
7. Probar que `wipeAll` está deshabilitado (sin `ALLOW_WIPE`).
8. Desplegar el frontend sin la clave (B.1-B.3).
9. Verificar que no hay secretos en el HTML servido.
10. Comprobar que los datos no cambiaron.

**Advertencia sobre el orden:** entre el paso 4 (rotar la clave) y el paso 8 (desplegar el frontend nuevo), el frontend **viejo** — que todavía está en producción y todavía intenta mandar la clave vieja — vería fallar la sincronización con el mensaje genérico de "sin conexión" que existe hoy, no con el mensaje nuevo de mantenimiento (ese llega recién en el paso 8). Es una ventana corta y no destructiva (no pierde datos, solo se ve menos claro), pero preferible saberlo antes: **recomiendo tener listos los pasos 3 y 8 para ejecutarlos en la misma sesión, sin pausa larga entre ellos**, así se minimiza esa ventana. Priorizar cerrar el hueco de seguridad primero (tu orden) sigue siendo lo correcto — esto es solo una nota de UX, no un cambio al orden.

## Casos de prueba — resultado esperado exacto

| # | Prueba | Resultado esperado |
|---|---|---|
| 1 | `GET /edits` sin autenticación | `401` |
| 2 | `GET /sent` sin autenticación | `401` |
| 3 | `POST /edits` sin autenticación | `401` (ya es así hoy, se reconfirma sin cambios) |
| 4 | `wipeAll` con la clave antigua (después de rotar) | Rechazado — `401` (clave inválida) |
| 5 | `wipeAll` con la clave nueva pero sin `ALLOW_WIPE=true` | Rechazado — `403` |
| 6 | Visitar cualquier URL con `?reset=1` | No ejecuta ninguna escritura — el bloque ya no existe en el código |
| 7 | Ver código fuente del HTML servido en producción | Sin ninguna ocurrencia de `SYNC_KEY` ni de ningún valor de clave |
| 8 | Búsqueda en todo el repositorio de la clave activa (la nueva, una vez rotada) | 0 resultados — nunca se escribe en ningún archivo del repo |
| 9 | Conteos de D1 antes/después del despliegue | Sin cambios: 148 edits / 39 deleted / 79 newInvs |
| 10 | Totales financieros antes/después | Sin cambios: los mismos de siempre, el parche no toca datos |
| 11 | Facturas históricas | Siguen visibles exactamente igual — no dependen de la red |

## Confirmación — producción sigue intacta

Nada de este documento se aplicó ni desplegó.
