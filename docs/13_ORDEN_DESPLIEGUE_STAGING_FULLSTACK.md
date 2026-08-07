# Orden completo — probar frontend + backend de staging juntos

## Por qué hace falta un frontend de staging aparte

Hoy solo existe staging del backend (D1 + Worker `supremekv1-staging`). El frontend (`index.html`) tiene **8 referencias hardcodeadas** a la URL de producción (`worker-supremekv1` en `https://supremekv1.michka1620.workers.dev`, líneas 2570, 2613, 2674, 2738, 3023, 3257, 3949, 3950). Sin una copia del frontend apuntando a las URLs de staging, cargar datos en staging no prueba nada del código real — nadie estaría mirando esos datos a través del código corregido.

## Orden propuesto

1. **Seguridad del Worker** — ya entregado (`12_SEGURIDAD_ENDPOINTS.md`). Pendiente tu decisión sobre si se corrige antes de continuar.
2. **Preparar una copia de `index.html` para staging** (no tocar el archivo real): copiar `index.html` a `index.staging.html` y reemplazar las 8 URLs de producción por las de staging (`supremekv1-staging.michka1620.workers.dev`), incluyendo el diff temporal de deduplicación ya probado. Esto es un archivo nuevo, aparte, nunca desplegado a producción.
3. **Desplegar exclusivamente el frontend de staging** — requiere que crees, igual que con el backend, un Worker nuevo en Cloudflare (ej. `bold-mouse-3bc3-staging`) sirviendo únicamente `index.staging.html`. Esto sí necesita tu acceso al dashboard, igual que los pasos anteriores de staging.
4. **Verificar que apunta al Worker de staging** — abrir la URL nueva del frontend de staging, y confirmar en las herramientas de red del navegador que las llamadas van a `supremekv1-staging...`, nunca a `supremekv1...` (producción).
5. **Cargar el payload de cuarentena** (`backups/staging_quarantine_edits_payload.json`) contra el backend de staging.
6. **Ejecutar los 8 checks** — con `scripts/validate_staging.py` (no imprime datos sensibles) y visualmente en el frontend de staging desplegado.
7. **Probar la reversión** — la específica primero (ver `14_PRUEBA_REVERSION_MECANICA.md`), `wipeAll` solo si falla.
8. **Retirar el despliegue de staging si algo falla** — borrar el Worker `bold-mouse-3bc3-staging` y `index.staging.html` no deja ningún rastro en producción, porque nunca compartieron ningún recurso.

Nada de esto se ejecuta todavía — es la propuesta de orden que pediste, a la espera de tu aprobación paso por paso como en todo lo anterior.
