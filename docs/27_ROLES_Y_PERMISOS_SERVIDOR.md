# 4. Roles y permisos — aplicados en el servidor, no en el frontend (diseño, NO implementado)

## Tabla confirmada

| Usuario | Lectura | Crear/editar | Enviar | Pagos | Administración |
|---|---|---|---|---|---|
| Michelle | Todo | Todo | Sí | Sí | Sí |
| Luis | Solo sus operaciones | Solo servicios/capturas propias | No | No | No |
| John | Solo sus operaciones | Solo servicios/capturas propias | No | No | No |

## Cómo se aplica cada fila en `worker-supremekv1/worker.js` (diseño de la lógica, no el diff completo — eso amerita su propia revisión aparte de la de acceso)

- **Lectura ("sus operaciones" para Luis/John):** el Worker filtra la respuesta de `GET /edits` según `currentRole()`/`currentEmail()` antes de devolverla — si el rol no es `admin`, se excluyen del JSON las facturas cuyo `tech.name` no coincide con el usuario autenticado. Requiere una función `normalizeTechName` para comparar el correo verificado contra el campo de texto libre `tech.name` (que hoy tiene variantes: "Luis"/"luis"/"LUIS") — un mapa correo → nombre de técnico, mantenido a mano por ahora (3 personas).
- **Crear/editar (solo servicios/capturas propias):** en `POST /edits`, para cada `newInvs` que llega, si el rol no es `admin`, se rechaza cualquier factura cuyo `tech.name` no corresponda al usuario que la envía — no puede crear una factura a nombre de otro técnico. Para `edits` sobre una clave ya existente, el Worker debe primero leer el registro actual en D1 y confirmar que su `tech.name` corresponde al usuario, antes de aceptar el cambio.
- **Enviar (No para Luis/John):** si un `edits` incluye un cambio al campo `sentState` (pasar a Enviada), se rechaza si el rol no es `admin`.
- **Pagos (No para Luis/John):** igual, si el cambio incluye `status: 'PAID'` o `sentState: 2` (Cobrada), se rechaza si el rol no es `admin`.
- **Administración (No para Luis/John):** ya cubierto — `wipeAll` exige `role === 'admin'` y además `ALLOW_WIPE === 'true'`. Lo mismo aplicaría a futuro para acciones de cuarentena.

## Por qué esto es enforcement real, no solo ocultar botones

Todas las reglas de arriba se evalúan **en el Worker**, antes de tocar D1 — un usuario técnico que intente mandar directamente un `POST /edits` con `sentState` cambiado (saltándose el frontend por completo, con herramientas como `curl`) sería rechazado igual, porque el Worker nunca confía en lo que dice el frontend sobre quién es el usuario o qué se le permite — solo confía en `X-Verified-Email`/`X-Verified-Role`, que él mismo generó a partir del JWT validado (ver `docs/25`).

## Honesto: esto es más código que el parche de acceso solo

Lo de arriba es el diseño correcto, pero es una pieza más grande que "cerrar la lectura pública" — toca la lógica de negocio de `POST /edits`, no solo la autenticación. Se puede desplegar en un segundo paso, después de que el acceso básico (login + Service Binding + JWT) esté probado y funcionando — no hace falta que todo llegue en el mismo cambio. Lo dejo diseñado aquí; el diff completo de este bloque específico se entrega aparte cuando lo autorices, para no mezclar dos revisiones grandes en una.
