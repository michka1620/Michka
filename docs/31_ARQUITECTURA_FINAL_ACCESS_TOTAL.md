# Arquitectura final — Access protege toda la aplicación (diseño, NO implementado)

Corrige el alcance: ya no es "solo `/api/*`". Cloudflare Access se configura sobre **todo el hostname** `bold-mouse-3bc3.michka1620.workers.dev` — sin excluir ninguna ruta, ningún archivo, nada.

```
Usuario                          Cloudflare Edge                    Worker "bold-mouse-3bc3"          Worker "supremekv1"
   │                            (Access: TODO el hostname)                                              (sin ruta publica)
   │  GET /  (o cualquier ruta)          │                                    │                              │
   ├──────────────────────────────────►  │                                     │                              │
   │                                     │  sin sesion -> login de Access       │                              │
   │  ◄──────────────────────────────────┤  (pantalla de Cloudflare, no la app)  │                              │
   │  ...completa login (OTP)...         │                                       │                              │
   │                                     │  con sesion -> deja pasar + agrega     │                              │
   │                                     │  Cf-Access-Jwt-Assertion                │                              │
   │                                     ├─────────────────────────────────────►  │                              │
   │                                     │                                        │  verifica JWT (Web Crypto)    │
   │                                     │                                        │  para TODA solicitud            │
   │                                     │                                        │  (estatico o /api/*)             │
   │                                     │                                        │                                   │
   │                                     │                              si /api/*: reenvia via                        │
   │                                     │                              Service Binding SUPREMEKV                      │
   │                                     │                                        ├──────────────────────────────────► │
   │                                     │                                        │   con X-Verified-Email/Role          │
   │                                     │                                        │   (nunca el JWT crudo)                │
   │                                     │                                        │                                        │
   │                                     │                              si estatico: sirve index.html                     │
   │                                     │                              (ya paso la verificacion arriba)                    │
```

## Qué verá una persona sin sesión

**La pantalla de login de Cloudflare Access — nunca la app, nunca `index.html`.** Access intercepta la solicitud en el borde de Cloudflare, antes de que llegue al Worker — ni el HTML, ni el CSS, ni un solo byte de `HISTORICAL_DATA` se entrega. Ni abriendo la URL en el navegador, ni con `curl`, ni con ninguna herramienta — es el mismo mecanismo que ya confirmaste funcionando para `/edits` (respuesta 302), aplicado ahora a todo el sitio.

## Cómo iniciarán sesión Michelle, Luis y John

Igual para los 3, en escritorio o iPhone: abren la URL de siempre, Cloudflare muestra su pantalla de login, escriben su correo, reciben un código de 6 dígitos, lo escriben, entran — recién ahí ven la app. Nada de esto lo construimos nosotros; lo provee Cloudflare Access directamente.

## Cuánto dura la sesión

Lo defines tú en la política de Access (campo "Session Duration"). Recomiendo algo como 24 horas para uso diario cómodo sin re-loguear todo el tiempo, pero es completamente ajustable — puedes ponerlo más corto si prefieres más seguridad a costa de pedir login más seguido.

## Cómo se revoca el acceso de alguien

Dos niveles, no uno solo:
1. **Quitar su correo de la política de Access** — impide que vuelva a iniciar sesión desde ese momento. No corta una sesión ya activa por sí solo.
2. **Revocar la sesión activa desde el dashboard de Zero Trust** (Access → Sesiones/Logs → revocar) — corta el acceso de inmediato, aunque la persona ya estuviera adentro. Para una salida inmediata de verdad (ej. perdió el teléfono), se necesita este paso, no solo el primero.

## Cómo se cierra sesión

Cloudflare Access expone un endpoint de logout propio: `https://bold-mouse-3bc3.michka1620.workers.dev/cdn-cgi/access/logout`. Se propone agregar un botón "Cerrar sesión" en la app que navegue ahí — sin código de logout propio que mantener.

## Cómo funcionará en Safari de iPhone

Ahora que Access protege el mismo dominio que sirve la app, la cookie de sesión es de **primera parte** desde el primer momento — no hay ningún escenario "entre sitios" del que Safari deba protegerte. Es exactamente la razón por la que elegiste la Opción B.

## Qué pasa si el código por correo no llega

Es una dependencia real de que el correo de esa persona reciba el mensaje de Cloudflare (revisar spam es el primer paso). Si de verdad nunca llega, Cloudflare Access permite reenviar el código desde la misma pantalla de login; si el problema persiste, hay que confirmar en la política de Access que el correo está escrito exactamente igual que el real. Se agrega como prueba obligatoria de staging (ver `docs/30` actualizado) probar la entrega del correo con los 3 correos reales antes de dar esto por bueno en producción.

## Sesión de trabajo — permisos, alcance acordado para este primer parche

Se conserva exactamente lo que pediste: Michelle, Luis y John pueden iniciar sesión; se elimina todo secreto del frontend; se bloquea lectura y escritura pública; `wipeAll` queda rechazado por defecto (gated por rol + `ALLOW_WIPE`, ver `docs/32`); se elimina `?reset=1`; D1 queda intacto. Los permisos detallados por técnico (qué ve cada uno, filtrado de facturas) quedan para una segunda etapa — no se presentan como resueltos en este parche, ni se disfraza "ocultar botones" como si fuera seguridad real; toda restricción de este parche se aplica en el servidor, no en el frontend.
