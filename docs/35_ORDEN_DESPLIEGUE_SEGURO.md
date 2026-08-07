# Orden de despliegue seguro — staging y producción (diseño, NO ejecutado)

## Staging — tu orden, confirmado sin cambios

1. Crear frontend de staging (`bold-mouse-3bc3-staging`), protegido completamente por Access.
2. Configurar el Service Binding `SUPREMEKV` hacia `supremekv1-staging`.
3. Desplegar el frontend de staging con la validación JWT (v3, `docs/34`).
4. Desplegar el Worker interno de staging (`supremekv1-staging`) con el código que confía en `X-Verified-Email`/`Role` y sin `wipeAll`.
5. Desactivar la URL pública `workers.dev` de `supremekv1-staging`.
6. Confirmar que su URL pública ya no responde.
7. Confirmar que `/api/edits` sí funciona desde el frontend de staging autenticado.
8. Ejecutar todas las pruebas (`docs/36`).

## Producción — un hallazgo importante que cambia el orden que había propuesto antes

Hay una secuencia peligrosa que hay que evitar explícitamente: si se despliega primero el código nuevo de `supremekv1` (el que confía en `X-Verified-Email` con solo comprobar que el header existe) **mientras su ruta pública todavía está activa**, cualquiera en internet podría mandar su propio header `X-Verified-Email: cualquier@correo` directamente a `supremekv1.michka1620.workers.dev` y ser aceptado — **sin necesitar ningún JWT, ninguna clave, nada.** Sería peor que la situación actual (que al menos exige una clave), aunque sea por un instante.

**Por eso, para producción, el orden correcto es desactivar la ruta pública primero, y recién después desplegar el código que confía en esos headers** — así nunca coexisten "código que confía ciegamente" y "ruta alcanzable desde internet":

1. Snapshot final de D1 y checksums (igual que en cada corrección anterior).
2. Confirmar que **todas** las pruebas de staging (`docs/36`) pasaron, sin excepciones.
3. **Desactivar la ruta pública `workers.dev` de `supremekv1` (producción) — antes de tocar su código.** Esto corta de inmediato la sincronización actual (la que ya depende de la clave rotada por ti) — interrupción esperada y ya aceptada, no es un efecto secundario indeseado.
4. Configurar el Service Binding `SUPREMEKV` en la configuración de producción de `bold-mouse-3bc3`.
5. Desplegar el código nuevo de `supremekv1` (confía en los headers) — seguro ahora, porque es inalcanzable por cualquier otro camino que no sea el binding.
6. Desplegar el `_worker.js` y `index.html` nuevos en `bold-mouse-3bc3`.
7. Activar la Access Application sobre todo `bold-mouse-3bc3...` en producción.
8. Verificar extremo a extremo: login, `/api/edits` funcionando, `wipeAll` inexistente, sin secretos en el HTML servido, conteos y totales sin cambios.

En ningún momento de esta secuencia existe una ventana donde el Worker interno confíe en encabezados mientras sigue expuesto a internet — el paso 3 lo cierra antes de que el paso 5 lo vuelva "confiado". No se ejecuta nada de esto todavía — es el orden propuesto para cuando autorices producción, que sigue siendo un paso aparte, después de staging.
