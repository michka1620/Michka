# Opción B — mismo origen vía Service Binding (diseño, NO implementado)

## 1. Diagrama exacto

```
Navegador (Michelle / Luis / John)
        │
        │  GET /              -> carga la app, SIN necesitar login (historial siempre visible)
        │  fetch('/api/edits') -> con cookie de sesion, si existe
        ▼
┌────────────────────────────────────────────────────┐
│  Cloudflare Edge                                     │
│  Access Application: bold-mouse-3bc3....workers.dev  │
│  Path protegido: /api/*  (el resto del sitio, libre)  │
│  Politica: login por correo (OTP), 3 emails            │
└───────────────┬──────────────────┬────────────────────┘
    sin sesion   │                  │ con sesion valida
   ────────────► │                  │ (agrega headers Cf-Access-*)
   pantalla login │                  ▼
   de Cloudflare   │      ┌──────────────────────────────┐
   (misma pestaña,  │      │ Worker "bold-mouse-3bc3"        │  <- UNICO worker publico
   mismo dominio)    │      │ (_worker.js)                     │
                     │      │  - sirve index.html normalmente   │
                     │      │  - si la ruta empieza en /api/ ->  │
                     │      │    la reenvia por Service Binding   │
                     │      └──────────────┬───────────────────┘
                     │                     │ env.SUPREMEKV.fetch(req)
                     │                     │ (llamada interna Worker-a-Worker,
                     │                     │  NUNCA sale a internet publico)
                     │                     ▼
                     │      ┌──────────────────────────────────────┐
                     │      │ Worker "supremekv1"                     │  <- SIN ruta publica
                     │      │ (worker-supremekv1/worker.js)             │     (deshabilitada)
                     │      │  - valida el JWT de Access CRIPTOGRAFICAMENTE│
                     │      │    (firma, issuer, audience, expiracion)      │
                     │      │  - identifica al usuario por el email del       │
                     │      │    JWT ya verificado (no solo del header)        │
                     │      │  - aplica el rol (admin / tecnico)                │
                     │      │  - lee/escribe D1 (SUPREME_DB)                     │
                     │      └────────────────────────────────────────────────────┘
```

## 2. Configuración manual en Cloudflare (tuya)

1. **Reconfigurar la aplicación de Access existente:** hoy protege `supremekv1...`. Cámbiala (o crea una nueva) para que proteja `bold-mouse-3bc3.michka1620.workers.dev` con **ruta `/api/*` únicamente** — así la app en sí sigue cargando sin login, solo la API queda detrás de Access. Mantén la misma política (los 3 correos, OTP).
2. **Anota dos valores** de esa aplicación de Access (no son secretos — ver nota abajo): el **AUD tag** (Access → esa aplicación → Overview) y tu **dominio de equipo** (`<algo>.cloudflareaccess.com`, visible en Zero Trust → Settings).
3. **Deshabilita la ruta pública de `supremekv1`:** Worker `supremekv1` → Settings → Domains & Routes → quitar/desactivar la ruta `workers.dev`. Deja de ser alcanzable directamente desde internet.
4. **Agrega el Service Binding** en el Worker `bold-mouse-3bc3` (dashboard → Settings → Bindings → Add → Service binding, o vía `wrangler.toml` como en el diff de `docs/24`) apuntando a `supremekv1`.
5. **Agrega `ACCESS_TEAM_DOMAIN` y `ACCESS_AUD`** como variables de entorno (no como Secret — no otorgan acceso por sí solos, ver nota) en el Worker `supremekv1`.

**Nota importante — por qué el AUD tag y el team domain NO son como `SYNC_KEY`:** son identificadores públicos que el Worker usa para verificar una firma que solo Cloudflare puede producir. Conocerlos no permite falsificar un login — la clave de firma nunca sale de Cloudflare. Está bien que vivan en variables normales, incluso en el código si hiciera falta.

## 5. Método exacto de validación del JWT

El header `Cf-Access-Authenticated-User-Email` por sí solo **no se valida criptográficamente en el Worker** — se confía en que Access ya filtró todo antes. Para cumplir tu punto 4/5 (validar de verdad), el Worker debe:

1. Leer el JWT del header `Cf-Access-Jwt-Assertion` (Access lo agrega automáticamente en cada solicitud que dejó pasar).
2. Obtener las claves públicas de Cloudflare desde `https://<tu-team-domain>/cdn-cgi/access/certs` (endpoint público, documentado por Cloudflare, específico de tu cuenta).
3. Verificar la firma del JWT contra esas claves.
4. Verificar `iss` (issuer) = `https://<tu-team-domain>`.
5. Verificar `aud` (audience) = el AUD tag de la aplicación de Access.
6. Verificar `exp` (expiración) — rechazar si ya venció.
7. Solo si las 4 verificaciones pasan, usar el `email` que viene **dentro del JWT ya verificado** (no del header suelto) para identificar al usuario.

Se propone usar la librería `jose` (estándar, mantenida, funciona en el runtime de Workers) con sus funciones `createRemoteJWKSet` + `jwtVerify`, que hacen los pasos 2-6 en una sola llamada, en vez de escribir la verificación de firma a mano (más riesgo de un error sutil). El diff exacto está en `docs/24`.

## 6. Tabla de permisos por rol

| Acción | Michelle (admin) | Luis (técnico) | John (técnico) |
|---|---|---|---|
| Leer `/api/edits`, `/api/sent` | Sí | Sí | Sí |
| Crear/editar facturas | Sí | Sí | Sí |
| `wipeAll` | Sí (+ `ALLOW_WIPE=true`) | No | No |
| Subir capturas (`/api/captures`, futuro) | Sí | Sí | Sí |
| Marcar factura en cuarentena (futuro) | Sí | No | No |
| Ver utilidades/información financiera sensible (futuro) | Sí | No | No |

**Honesto:** hoy `/api/edits` devuelve todo en un solo bloque — restringir "ver totales financieros" a nivel de campo requiere rediseñar la respuesta por rol, que es trabajo aparte (el mismo pendiente de "Usuarios" que ya se dejó para después). Lo que sí es aplicable hoy mismo, sin rediseño: `wipeAll` solo para `admin`.

## 7. Flujo de login — iPhone y escritorio (igual en ambos, esa es la ventaja de mismo origen)

1. Cualquiera de los 3 abre `bold-mouse-3bc3...` — la app carga normal, sin pedir nada (el historial vive en el archivo, no depende de la API).
2. La app intenta `fetch('/api/edits', {credentials:'include'})`. Si no hay sesión de Access todavía, la respuesta no es el JSON esperado.
3. La app muestra el botón "Iniciar sesión para sincronizar".
4. Al tocarlo, se navega (misma pestaña, mismo dominio) a una ruta bajo `/api/` — como es una navegación real (no un `fetch` de fondo), Cloudflare Access sí puede mostrar su pantalla de login interactiva: correo → código de 6 dígitos → confirmar.
5. Cloudflare redirige de vuelta a la app, ya con la cookie de sesión puesta **para el mismo dominio que la persona está usando** — de primera parte, sin nada del problema de Safari que tenía la Opción A.
6. La app reintenta la sincronización, ahora funciona, y sigue funcionando sola mientras la sesión no expire.

## 8. Pruebas en Safari real — quién las ejecuta

**Esto no lo puedo probar yo.** Requiere un iPhone físico y una persona real completando el login por correo (recibir el código, escribirlo) — no es algo que pueda simular desde este entorno. Checklist para que lo corras tú o Luis/John, primero en staging:

1. Abrir la app de staging en Safari de iPhone (no en modo escritorio).
2. Confirmar que carga sin pedir login.
3. Confirmar que el botón "Iniciar sesión" aparece cuando se intenta sincronizar.
4. Completar el login por correo.
5. Cerrar Safari completamente (no solo la pestaña) y volver a abrir la app — confirmar que la sesión sigue activa (no vuelve a pedir login de inmediato).
6. Esperar unos minutos con la app en segundo plano, volver — confirmar que sigue sincronizando.
7. Repetir en modo incógnito/privado de Safari — confirmar que ahí sí pide login cada vez (comportamiento esperado, es una sesión nueva).

## 9. Plan de reversión

Todo lo nuevo es configuración + código aditivo:
- Quitar el Service Binding y volver a habilitar la ruta pública de `supremekv1` revierte la arquitectura sin tocar ningún dato.
- El código (`_worker.js`, `worker.js`, `index.html`) se revierte con `git revert`, igual que en los parches anteriores.
- Nada de esto toca D1, ni el esquema, ni ninguna factura.

## 10. Confirmación — producción sigue intacta

Nada de este diseño se aplicó todavía.
