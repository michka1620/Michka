# Arquitectura de autenticación con Cloudflare Access (diseño, NO implementado)

Contención manual confirmada por Michelle: Access activo en `supremekv1`, `SYNC_KEY` rotada y guardada como Secret. Esto ya cierra el hallazgo crítico de lectura pública — lo de abajo es el siguiente paso: hacer que la app vuelva a sincronizar sin ningún secreto en el navegador.

## 1. Arquitectura recomendada

Cloudflare Access, con **email de un solo uso (One-Time PIN)** como método de login — no requiere Google Workspace ni ningún proveedor de identidad aparte, solo agregar los 3 correos (Michelle, Luis, John) a la política de Access. Cloudflare les manda un código de 6 dígitos por correo cuando inician sesión; no hay contraseña que crear, recordar ni rotar.

**Hay una decisión de arquitectura real que debes tomar antes de programar** — dos opciones:

### Opción A — dominios separados (como hoy)
`index.html` sigue en `bold-mouse-3bc3...` y llama a `supremekv1...` (dominio distinto). Access protege `supremekv1` directamente. Es la config más simple de activar (ya la tienes activa así).

**Riesgo real, no teórico:** la sesión de Access se guarda en una cookie del dominio `supremekv1...`. Como el `fetch()` se hace desde `bold-mouse-3bc3...`, es una cookie "de terceros" desde la perspectiva del navegador. **Safari (el que usan Luis y John en iPhone, confirmado en capturas de esta semana) bloquea o expira agresivamente ese tipo de cookies** incluso configuradas correctamente — es su protección anti-rastreo (ITP), no un error de configuración. Con la Opción A, es probable que la sincronización falle o se desconecte sola en los teléfonos que más se usan para esto, de forma intermitente y difícil de diagnosticar.

### Opción B — un solo dominio (recomendada)
Enrutar las llamadas a la API bajo el mismo dominio que sirve la app: en vez de `https://supremekv1.michka1620.workers.dev/edits`, algo como `https://bold-mouse-3bc3.michka1620.workers.dev/api/edits`. Se logra con una regla de enrutamiento de Cloudflare o un Service Binding entre los dos Workers — configuración adicional de tu lado en el dashboard, pero no código complejo.

Con esto, la cookie de Access es de **primera parte** (mismo dominio que la página) — el comportamiento de Safari deja de ser un problema, porque ya no es un contexto "entre sitios". Es más confiable en todos los dispositivos, especialmente los que más importan aquí (los celulares de Luis y John).

**Mi recomendación: Opción B.** Cuesta un paso más de configuración ahora, pero la Opción A tiene un riesgo concreto de fallar justo donde más se necesita (el celular en la calle).

## 2. Cómo iniciarían sesión Michelle, Luis y John

1. Tú agregas sus 3 correos a la política de Access de Cloudflare (uno por uno, desde el dashboard — nada de esto lo hago yo).
2. La primera vez que cada uno use la app (o cuando expire la sesión, según la duración que configures — por ejemplo 7 días), la app detecta que no hay sesión válida y muestra un botón claro: **"Iniciar sesión para sincronizar."**
3. Al tocarlo, se abre la pantalla de login de Cloudflare Access — piden su correo, Cloudflare les manda un código de 6 dígitos, lo escriben, listo.
4. De ahí en adelante, mientras la sesión siga vigente, la sincronización funciona sola, sin volver a pedir nada.

## 3. Cómo sabe el Worker quién hace cada acción

Cloudflare Access, una vez que deja pasar una solicitud, le agrega automáticamente un header que **Cloudflare firma y el cliente no puede falsificar**: `Cf-Access-Authenticated-User-Email`. El Worker simplemente lo lee — ya sabe, con certeza, qué correo autenticado hizo esa solicitud. De ahí se deriva el rol con una tabla simple correo → rol (Michelle = admin, Luis/John = técnico), sin necesidad de contraseñas ni tokens propios.

## 4. Cómo funcionará el frontend sin `SYNC_KEY`

- `_syncHeaders()` deja de mandar cualquier `x-api-key` — ya no existe ningún secreto que mandar.
- Los `fetch()` hacia la API deben incluir `credentials: 'include'`, para que el navegador adjunte automáticamente la cookie de sesión de Access (si existe y es válida).
- Si Access rechaza la solicitud (sin sesión o expirada), la respuesta no será el JSON normal — el código debe detectar eso específicamente y mostrar el botón de "Iniciar sesión", en vez de tratarlo como un error genérico de conexión.

## 7. Qué deja de funcionar temporalmente

Lo mismo que en el parche anterior (sincronización pausada hasta iniciar sesión; historial siempre visible; ediciones locales se guardan en `localStorage` esperando), más una advertencia nueva: **hasta que se pruebe en un iPhone real (paso 8), hay que asumir que con la Opción A la sesión podría cortarse sola más seguido de lo esperado** — es la razón concreta para preferir la Opción B antes de dar esto por resuelto.
