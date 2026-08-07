# Plan de rotación de la clave comprometida

La clave actual (`NjqjcbvNyuhTSJHcqDJRJS4d4Jns8xpY`) queda considerada comprometida desde ahora. No se reutiliza en staging, producción, documentación, pruebas ni scripts — ya se verificó que no aparece en ningún archivo del repo salvo como referencia histórica de "esta quedó expuesta" (nunca como clave activa).

## Orden para rotarla sin dejar producción sin protección en ningún momento

1. **Tú generas la nueva clave** directamente en Cloudflare (Worker `supremekv1` → Settings → Variables and Secrets → editar `SYNC_KEY`) — nunca se escribe en el chat, en código, en commits ni en logs, tal como pediste.
2. Antes de guardar la nueva clave en Cloudflare, se despliega primero el parche del Worker (diff 1 de `16_PARCHE_EMERGENCIA.md`) — así el `GET` ya queda protegido incluso mientras la clave vieja todavía es válida por unos minutos.
3. Guardas la nueva clave como secreto en Cloudflare.
4. Se despliega el `index.html` parchado (diff 2 y 3) — sin ninguna clave incrustada.
5. Cada dispositivo (el tuyo, el de Luis, el de John) entra una vez a la app, abre la pantalla de configuración, y pega la nueva clave en el campo nuevo (`saveSyncKey()`) — se guarda solo en el `localStorage` de ese navegador, nunca en ningún archivo del repo.
6. Mientras cada dispositivo no tenga la clave nueva, ese dispositivo ve el banner de "sin conexión" ya existente — no pierde datos, solo no sincroniza hasta que se le entregue la clave.

## Plan para que la clave nunca vuelva a estar en el frontend

Cubierto por el diff 2 de `16_PARCHE_EMERGENCIA.md`: la clave deja de ser una constante en el código fuente y pasa a vivir únicamente en el `localStorage` de cada dispositivo, entrada una sola vez por cada persona. Esto es la solución temporal — sigue siendo un secreto compartido (las 3 personas usan la misma clave), pero deja de estar en un archivo público descargable por cualquiera. La solución definitiva (sesiones individuales, sin ningún secreto compartido) está en `18_ARQUITECTURA_AUTENTICACION_FUTURA.md`, sin implementar todavía.
