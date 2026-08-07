# Arquitectura futura de autenticación — diseño, NO implementado

## Roles

- **Michelle — Administradora:** acceso completo, incluyendo información financiera, cuarentena, `wipeAll`, gestión de usuarios.
- **Luis — Operaciones/Técnico:** subir capturas, ver sus propios servicios, agregar notas — sin ver utilidades ni datos financieros sensibles.
- **John — Técnico:** igual que Luis.

## Flujo de sesión

1. **Login:** endpoint `POST /login` recibe usuario + contraseña (o PIN). El Worker verifica contra una tabla `usuarios` en D1 (contraseñas nunca en texto plano — hash con PBKDF2 vía `crypto.subtle`, disponible nativo en Workers).
2. **Token de sesión:** si la contraseña es correcta, el Worker emite un token firmado (HMAC, con una clave que vive solo como secreto del Worker, nunca en el navegador) que incluye: id de usuario, rol, fecha de emisión, fecha de expiración (ej. 12-24 horas).
3. **Cada solicitud protegida** debe incluir ese token (header `Authorization`). El Worker lo verifica: firma válida, no expirado, no revocado.
4. **Ningún secreto compartido vive en el navegador** — el token es individual, temporal, y revocable; no es lo mismo que la `SYNC_KEY` actual (una sola clave, permanente, igual para todos).

## Permisos por rol (aplicados en el Worker, no solo en el frontend)

Cada endpoint valida el rol del token antes de ejecutar la acción — por ejemplo, `wipeAll` solo se ejecuta si el rol es `admin`; un técnico puede hacer `POST` de una captura nueva pero no puede editar el total de una factura ya marcada como pagada.

## Auditoría de acciones

Tabla nueva `auditoria`: quién (id de usuario, no solo "alguien con la clave"), qué acción, qué campo cambió, valor anterior, valor nuevo, fecha y hora. Se llena automáticamente en cada escritura — sustituye la limitación actual de "no hay forma de saber quién hizo qué".

## Sesiones revocables

Tabla `sesiones_revocadas` (o simplemente expiración corta + no renovación automática): si hay que cerrar el acceso de alguien de inmediato (ej. un dispositivo perdido), se invalida su token sin necesidad de rotar la clave de todos los demás — a diferencia de hoy, donde la única forma de "revocar" es cambiar la clave que usan las 3 personas a la vez.

## Límites de solicitudes

Reglas de rate limiting nativas de Cloudflare (configurables desde el dashboard, sin código) por IP y/o por usuario — protege contra abuso incluso si un token se filtrara.

## Cierre de sesión

`logout` limpia el token del dispositivo y, si se implementa la tabla de revocación, lo invalida también del lado del servidor de inmediato.

## Por qué no se implementa ahora

Es un sistema nuevo completo (tabla de usuarios, hashing de contraseñas, emisión y verificación de tokens, permisos por endpoint, UI de login) — no es aditivo como la cuarentena, cambia cómo se accede a todo el sistema. Se diseña aquí para que la solución temporal (parche de emergencia) no se construya de forma que después haya que rehacerla, pero se implementa como su propio proyecto, con su propia entrada en `EVOLUTION_LOG.md`, cuando lo autorices.
