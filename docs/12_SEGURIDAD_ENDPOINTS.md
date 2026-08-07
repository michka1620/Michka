# Seguridad de los endpoints — hallazgo crítico (2026-08-07)

## Hallazgo 1 — `GET /edits` y `GET /sent` son públicos, sin autenticación

Código exacto (`worker-supremekv1/worker.js`, líneas 85-98 y 173-179): el bloque `GET` de ambos endpoints no llama a `checkAuth()` en ningún punto — solo el bloque `POST` lo hace. Confirmado en vivo: durante toda esta conversación Claude leyó `https://supremekv1.michka1620.workers.dev/edits` sin ninguna clave y siempre recibió los datos completos.

**Expone:** nombre de empresa cliente, teléfono, dirección, nombre de conductor, PO, VIN, placa/estado del vehículo, nombre del técnico, notas de reparación, montos — para cualquiera que tenga la URL, sin login.

**Severidad: CRÍTICO.**

## Hallazgo 2 — la clave que protege la escritura tampoco es secreta en la práctica

`index.html` línea 3952: `var SYNC_KEY = 'NjqjcbvNyuhTSJHcqDJRJS4d4Jns8xpY';` — texto plano, dentro del archivo que la app sirve públicamente. Cualquiera que abra "ver código fuente" en el navegador la obtiene. Esto significa que el `POST` (escritura, incluyendo `wipeAll`) está protegido solo en apariencia — la protección real depende de que nadie mire el código fuente de una página web pública.

**Severidad: CRÍTICO — más grave que el hallazgo 1**, porque no es solo lectura, es escritura/borrado.

## Por qué pasa esto

Es un límite estructural, no un error puntual: una app estática sin sistema de login no tiene ningún lugar seguro donde guardar un secreto — todo lo que el navegador necesita para hablar con el servidor, el navegador lo expone. Mientras no exista autenticación real por usuario, cualquier "clave" en este modelo es, en el mejor de los casos, una barrera contra curiosos casuales, no contra alguien que busque el archivo fuente.

## Opciones (ninguna aplicada — solo evaluación)

1. **Mitigación inmediata:** agregar `checkAuth()` también a los bloques `GET`. Sube la barrera (hay que conocer la clave), pero no cierra el hallazgo 2 — la clave sigue en `index.html`.
2. **Solución de fondo:** autenticación real por usuario (sesión verificada en el servidor, el secreto nunca vive en el navegador). Es exactamente el trabajo de "Usuarios" que ya se dejó para después — este hallazgo es una razón adicional para no postergarlo indefinidamente, aunque hoy no se está implementando.

No se modificó `worker.js` ni `index.html` para esto — solo se documenta, según pediste.
