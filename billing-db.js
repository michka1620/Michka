// Atomic Invoice Supreme # reservation. Written against a small,
// deliberately minimal database interface (see the "db shape" note below)
// so the exact same logic can run against Node's built-in SQLite (for
// local, fictitious-data tests) and, later, against a real Cloudflare D1
// binding -- without rewriting the reservation algorithm itself.
//
// db shape expected:
//   db.exec(sql)                      -- run a statement with no params/results
//   db.get(sql, params) -> row|undefined
//   db.run(sql, params) -> { changes }
//   db.transaction(fn) -> runs fn() inside BEGIN IMMEDIATE / COMMIT, and
//                         ROLLBACK if fn() throws, re-throwing the error.
//
// IMPORTANT / not yet verified: this has been tested against Node's
// built-in SQLite (node:sqlite), which gives real ACID transactions and a
// real UNIQUE constraint. It has NOT been run against an actual Cloudflare
// D1 binding yet -- D1's binding API (`.prepare().run()`, `.batch()`) is a
// wrapper around SQLite, not raw SQLite, and its exact transaction/rollback
// semantics from within a Worker need to be confirmed (ideally via
// `wrangler d1 execute --local`, which does use real SQLite underneath)
// before this is trusted against the real BILLING_DB. Flagging this
// explicitly rather than assuming it "just works" the same way.

class DuplicateWoError extends Error {
  constructor(wo) {
    super(`WO ${wo} already has an assignment (race lost, caller should re-read)`);
    this.name = "DuplicateWoError";
    this.wo = wo;
  }
}

function getExistingAssignment(db, wo) {
  return db.get("SELECT wo, order_number, bloque_id, asignado_en, asignado_por FROM asignaciones_invoice WHERE wo = ?", [wo]);
}

// Reserves (or reuses) an Invoice Supreme # for a given WO. Idempotent: a
// retried call for the same `wo` always returns the same order_number,
// never burns a new one.
function reserveInvoiceNumber(db, { wo, bloqueId, asignadoPor, now }) {
  if (!wo) throw new Error("wo is required");
  if (!asignadoPor) throw new Error("asignadoPor is required");
  const nowIso = now || new Date().toISOString();

  const existing = getExistingAssignment(db, wo);
  if (existing) {
    return { orderNumber: existing.order_number, reused: true };
  }

  try {
    const orderNumber = db.transaction(() => {
      const row = db.get("SELECT siguiente_numero FROM invoice_counter WHERE id = 1");
      if (!row) throw new Error("invoice_counter not initialized");
      const next = row.siguiente_numero + 1;
      db.run("UPDATE invoice_counter SET siguiente_numero = ? WHERE id = 1", [next]);
      try {
        db.run(
          "INSERT INTO asignaciones_invoice (wo, order_number, bloque_id, asignado_en, asignado_por) VALUES (?, ?, ?, ?, ?)",
          [wo, next, bloqueId || null, nowIso, asignadoPor]
        );
      } catch (e) {
        // UNIQUE constraint violation (order_number or wo) -- someone else
        // won the race between our SELECT above and this INSERT. Throwing
        // here rolls back the counter increment too, since both statements
        // are inside the same transaction -- no number gets burned.
        throw new DuplicateWoError(wo);
      }
      return next;
    });
    return { orderNumber, reused: false };
  } catch (e) {
    if (e instanceof DuplicateWoError) {
      const retried = getExistingAssignment(db, wo);
      if (!retried) throw new Error("Lost the race but no assignment found on retry -- inconsistent state");
      return { orderNumber: retried.order_number, reused: true };
    }
    throw e;
  }
}

// Initializes invoice_counter from the real maximum Order# found across
// the full server truth (historical data + newInvs), NOT from this new
// table alone and NOT from localStorage. Refuses to guess if the maximum
// can't be determined with confidence.
function initCounterFromServerTruth(db, { historicalMax, newInvsMax }) {
  if (typeof historicalMax !== "number" || typeof newInvsMax !== "number") {
    throw new Error("Cannot initialize counter: historicalMax and newInvsMax must both be verified numbers. Stopping for manual review.");
  }
  const max = Math.max(historicalMax, newInvsMax);
  const existing = db.get("SELECT siguiente_numero FROM invoice_counter WHERE id = 1");
  if (existing) {
    throw new Error("invoice_counter already initialized (id=1 exists) -- refusing to overwrite. Manual review required.");
  }
  db.run("INSERT INTO invoice_counter (id, siguiente_numero) VALUES (1, ?)", [max]);
  return max;
}

export { reserveInvoiceNumber, initCounterFromServerTruth, getExistingAssignment, DuplicateWoError };
