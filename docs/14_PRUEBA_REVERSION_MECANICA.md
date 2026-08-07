# Cómo funciona realmente la reversión — probado, no asumido

## Código exacto del `POST /edits` (worker.js, dentro del bloque POST)

```js
for (const key of Object.keys(edits)) {
  const entry = edits[key];
  const diff = (entry && typeof entry === 'object' && 'diff' in entry) ? entry.diff : entry;
  const updatedAt = (entry && entry.updatedAt) || now;
  stmts.push(env.SUPREME_DB.prepare(
    `INSERT INTO edits (key, diff, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(key) DO UPDATE SET diff=excluded.diff, updated_at=excluded.updated_at
     WHERE excluded.updated_at >= edits.updated_at`
  ).bind(key, JSON.stringify(diff), updatedAt));
}
```

## Qué hace exactamente (no es merge)

- **Reemplaza el JSON completo** de esa clave — `SET diff=excluded.diff` sustituye el valor anterior entero, no lo combina campo por campo. El merge profundo (que sí conserva campos antiguos) ocurre después, en el navegador, cuando `index.html` aplica ese diff sobre `HISTORICAL_DATA` — **no** dentro del Worker ni de la base de datos.
- Está protegido por un guardia de tiempo: `WHERE excluded.updated_at >= edits.updated_at`. Si el `updatedAt` enviado fuera *anterior* al ya guardado, SQLite **no ejecuta el UPDATE** y la fila queda como estaba. Enviar un objeto simple (sin envoltura `{diff, updatedAt}`) hace que el Worker use `now()` como `updatedAt`, que siempre es posterior — así que el reemplazo si se aplica.
- **No permite "eliminar campos" de forma selectiva** — solo reemplazar el diff entero. Por eso, para retirar `dataIntegrity`/`quarantine` sin afectar nada más, el diff nuevo debe ser exactamente `{}` (vacío): reemplaza el diff completo de esa clave por nada, que es equivalente a que esa clave nunca hubiera tenido edición.

## Prueba con los archivos reales (offline, ya ejecutada)

Usando `backups/staging_quarantine_edits_payload.json` (aplicar) y `backups/staging_quarantine_REVERT_payload.json` (revertir) contra el snapshot real:

- Los 3 registros quedan **byte-idénticos** a su estado original tras la reversión — sin `dataIntegrity` ni `quarantine`.
- **0 otras claves de `edits`** resultan modificadas.
- **Detalle que no hay que asumir, sino saber:** la fila en la tabla `edits` de esas 3 claves **no se elimina**, queda con `diff='{}'` — es decir, pasa de 148 a 151 filas en la tabla física, aunque el resultado visible/funcional es idéntico al original. Si se necesita que la tabla también quede en exactamente 148 filas (0 residuales), la única forma con el código actual es `wipeAll` + recarga desde el snapshot — que confirmaste que se deja como plan de emergencia, no como primera opción.

## Producción

Ninguna prueba de este documento tocó producción. Confirmado de nuevo: D1 de producción en 148/39/79, `main` sin cambios.
