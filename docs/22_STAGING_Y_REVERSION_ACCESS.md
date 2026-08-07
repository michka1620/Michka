# Prueba en staging y reversión — Cloudflare Access

## 8. Cómo probarlo en staging antes de tocar producción

1. Activar Cloudflare Access en `supremekv1-staging` (mismo proceso manual que ya hiciste en producción), con una política separada — puede ser solo tu correo por ahora, no hace falta agregar a Luis/John para la primera prueba técnica.
2. Si se elige la Opción B (recomendada), configurar el mismo enrutamiento de un solo dominio también para staging, para probar exactamente el mismo comportamiento que tendría producción.
3. Desplegar el `worker.js` y el `index.html` con el diff de `docs/21` **solo en staging**.
4. **Probar el login completo en un iPhone real, no solo en escritorio** — es el paso que decide si la Opción A es viable o si hace falta la B. Sin esta prueba específica no se puede dar por buena ninguna de las dos.
5. Confirmar con `scripts/validate_staging.py` que los conteos y totales no cambiaron — este cambio es solo de acceso, nunca debe mover un dato.
6. Confirmar que `wipeAll` sigue rechazado sin `ALLOW_WIPE=true`, y ahora también sin rol de administradora.
7. Confirmar que ninguna captura de pantalla ni el código fuente del HTML de staging contiene ningún secreto.

## 9. Plan de reversión

- **Código:** commit en la rama de trabajo, nunca en `main` sin tu aprobación — revertir es `git revert`, igual que las veces anteriores.
- **Cloudflare Access:** desactivarlo en el Worker (desde el dashboard, tuyo) no borra nada de datos — la app simplemente volvería a quedar sin esa capa hasta reactivarla. No es una operación destructiva sobre D1 ni sobre las facturas.
- **Enrutamiento de un solo dominio (si se elige Opción B):** quitar la regla de enrutamiento también es reversible sin tocar datos — los dos Workers vuelven a ser independientes como hoy.

## 10. Confirmación — producción sigue intacta

Confirmado en vivo justo ahora: `GET /edits` sin ninguna clave devuelve **HTTP 302** (redirección al login de Cloudflare Access) en vez del JSON con los datos — la contención manual que hiciste está funcionando en producción. `main` sigue en el commit `e84c503`, sin ningún push desde el equipo de Claude. No se aplicó ni desplegó nada de lo diseñado en este documento ni en `docs/20`/`docs/21`.
