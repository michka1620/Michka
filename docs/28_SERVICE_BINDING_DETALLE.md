# 5. Service Binding — configuración exacta (diseño, NO implementado)

| | Producción | Staging |
|---|---|---|
| Nombre exacto del binding | `SUPREMEKV` | `SUPREMEKV` (mismo nombre de variable, distinto destino) |
| Worker que lo declara | `bold-mouse-3bc3` | `bold-mouse-3bc3-staging` (frontend de staging, ver `docs/13`) |
| Worker de destino | `supremekv1` | `supremekv1-staging` |
| Dónde se configura | `wrangler.toml` de `bold-mouse-3bc3` (raíz del repo) | `wrangler.toml` **separado** para el frontend de staging |

```toml
# wrangler.toml de produccion (bold-mouse-3bc3)
[[services]]
binding = "SUPREMEKV"
service = "supremekv1"
```
```toml
# wrangler.staging.toml (frontend de staging) -- archivo DISTINTO, no una rama condicional del mismo archivo
[[services]]
binding = "SUPREMEKV"
service = "supremekv1-staging"
```

## Cómo evitar que staging apunte por error a producción

- **Archivos de configuración físicamente separados** (`wrangler.toml` vs `wrangler.staging.toml`), no un solo archivo con lógica de "si es staging usa X" — así un `service = "supremekv1"` mal copiado se ve directamente en el diff de revisión, no depende de una variable que alguien olvide cambiar.
- Los nombres de los Workers de destino ya son visualmente distintos (`supremekv1` vs `supremekv1-staging`) — un copy-paste descuidado es fácil de detectar en la revisión del PR.
- `scripts/validate_staging.py` (ya existe) siempre apunta explícitamente a la URL de staging vía variable de entorno — nunca a producción por defecto, así que cualquier verificación automatizada no puede "caer" en producción por accidente.
- Recomendación adicional: antes de aprobar el despliegue de staging, revisar a simple vista que el `wrangler.staging.toml` diga `supremekv1-staging`, no `supremekv1` — un solo vistazo al diff lo confirma.

## `fetch()` vs RPC

Se usa `fetch()`, no el estilo RPC (`WorkerEntrypoint`/llamadas a métodos con nombre) — porque `supremekv1` ya está escrito como un `fetch(request, env)` clásico, y cambiarlo a RPC significaría reestructurar ese archivo entero sin necesidad. Con `fetch()` a través del binding, `supremekv1` no cambia su forma — solo deja de recibir tráfico público y empieza a recibirlo por el binding, con el mismo `request` de siempre.

## Cómo se conservan método, cuerpo y ruta

```js
const innerRequest = new Request(innerUrl.toString(), {
  method: request.method,
  headers: innerHeaders,       // headers reconstruidos, ver docs/29
  body: (request.method === 'GET' || request.method === 'HEAD') ? undefined : request.body,
});
return env.SUPREMEKV.fetch(innerRequest);
```

El método se copia explícitamente (`GET`/`POST`/`OPTIONS`), la ruta se ajusta quitando el prefijo `/api`, y el cuerpo se reenvía como stream sin leerlo ni transformarlo — nadie en `_worker.js` parsea el JSON del cuerpo, así que no hay riesgo de "consumir" el stream antes de que le llegue a `supremekv1`. Este patrón de `new Request(url, request)` ya se usa hoy mismo en `_worker.js` para servir los archivos estáticos (líneas 5-7 del archivo actual) — no es una técnica nueva para este repo.
