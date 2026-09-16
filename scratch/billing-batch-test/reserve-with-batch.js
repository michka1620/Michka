// Reserves the next Invoice Supreme # using ONLY BILLING_DB.batch() -- no
// db.transaction(), no BEGIN/COMMIT/ROLLBACK. This is the scratch design
// meant to validate the algorithm against a real D1 binding before it gets
// ported back into billing-db.js.
//
// Counter semantics for THIS harness (per approved correction): invoice_counter
// .siguiente_numero holds the NEXT AVAILABLE number, not the last-used one.
// Starting value 900000000 -> first reservation gets exactly 900000000, and
// only THEN does the counter advance to 900000001.
//
// How atomicity works without an explicit transaction: D1's .batch() already
// runs its statements sequentially inside an implicit all-or-nothing
// transaction. So instead of the caller reading a value and feeding it into
// the next statement (which .batch() can't do -- statements are bound with
// static params up front), every statement derives what it needs from a
// live subquery evaluated at the moment IT executes within that same
// implicit transaction:
//
//   1) INSERT ... SELECT <counter> WHERE NOT EXISTS (already assigned?)
//      -- claims the CURRENT counter value for this wo, but only if no
//      assignment exists for it yet. Inserts 0 rows if we lost a race.
//   2) UPDATE counter SET +1 WHERE EXISTS (did statement 1 just insert
//      OUR row using the CURRENT counter value?)
//      -- advances the counter exactly once per successful claim, and is a
//      no-op if statement 1 did nothing (lost the race, or true concurrent
//      writer already advanced it).
//   3) SELECT the final order_number for this wo (ours if we won, the
//      other writer's if we lost) -- always returns the right answer either
//      way, in the same atomic unit.
//
// meta.changes from statement 1 tells us whether THIS call won (1) or lost
// the race (0) -- equivalent to the DuplicateWoError path in billing-db.js,
// but expressed as a batch-native no-op instead of a caught exception.

function nowIsoDefault() {
  return new Date().toISOString();
}

async function reserveInvoiceNumberBatch(env, { wo, bloqueId, asignadoPor, now }) {
  if (!wo) throw new Error("wo is required");
  if (!asignadoPor) throw new Error("asignadoPor is required");
  const nowIso = now || nowIsoDefault();

  // Fast path: already assigned (plain read, no batch needed). Mirrors
  // billing-db.js's idempotent-retry behavior.
  const existing = await env.BILLING_DB.prepare("SELECT order_number FROM asignaciones_invoice WHERE wo = ?1")
    .bind(wo)
    .first();
  if (existing) {
    return { orderNumber: existing.order_number, reused: true };
  }

  const insertStmt = env.BILLING_DB.prepare(
    `INSERT INTO asignaciones_invoice (wo, order_number, bloque_id, asignado_en, asignado_por)
     SELECT ?1, (SELECT siguiente_numero FROM invoice_counter WHERE id = 1), ?2, ?3, ?4
     WHERE NOT EXISTS (SELECT 1 FROM asignaciones_invoice WHERE wo = ?1)`
  ).bind(wo, bloqueId || null, nowIso, asignadoPor);

  const advanceCounterStmt = env.BILLING_DB.prepare(
    `UPDATE invoice_counter
     SET siguiente_numero = siguiente_numero + 1
     WHERE id = 1
       AND EXISTS (
         SELECT 1 FROM asignaciones_invoice
         WHERE wo = ?1 AND order_number = invoice_counter.siguiente_numero
       )`
  ).bind(wo);

  const readBackStmt = env.BILLING_DB.prepare("SELECT order_number FROM asignaciones_invoice WHERE wo = ?1").bind(wo);

  const [insertResult, , readBackResult] = await env.BILLING_DB.batch([insertStmt, advanceCounterStmt, readBackStmt]);

  const won = insertResult.meta.changes === 1;
  const row = readBackResult.results[0];
  if (!row) {
    throw new Error("Lost the race but no assignment found after batch -- inconsistent state");
  }
  return { orderNumber: row.order_number, reused: !won };
}

export { reserveInvoiceNumberBatch };
