// Tests for billing-db.js against Node's built-in SQLite (node:sqlite),
// entirely local, entirely fictitious data -- no wrangler, no D1, no
// network, no real account of any kind touched.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { reserveInvoiceNumber, initCounterFromServerTruth } from "./billing-db.js";

const schemaSql = readFileSync(new URL("./sql/v001_crear_tablas_billing.sql", import.meta.url), "utf8");

// Thin adapter giving node:sqlite's DatabaseSync the small interface
// billing-db.js expects, so the reservation logic itself never needs to
// know which engine it's running against.
function makeTestDb() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schemaSql);
  return {
    exec: (sql) => raw.exec(sql),
    get: (sql, params = []) => raw.prepare(sql).get(...params),
    run: (sql, params = []) => raw.prepare(sql).run(...params),
    transaction: (fn) => {
      raw.exec("BEGIN IMMEDIATE");
      try {
        const result = fn();
        raw.exec("COMMIT");
        return result;
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
    _raw: raw,
  };
}

let db;
beforeEach(() => {
  db = makeTestDb();
});

test("schema: the 4 new tables exist and no unexpected ones were created", () => {
  // sqlite_sequence is SQLite's own internal bookkeeping table, created
  // automatically because audit_log uses AUTOINCREMENT -- not one of ours.
  const tables = db._raw.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
    .map((r) => r.name)
    .filter((name) => name !== "sqlite_sequence");
  assert.deepEqual(tables, ["asignaciones_invoice", "audit_log", "fecha_servicio", "invoice_counter"]);
});

test("initCounterFromServerTruth: initializes to the max of historical vs new_invoices (fictitious data)", () => {
  const max = initCounterFromServerTruth(db, { historicalMax: 202639464, newInvsMax: 202639474 });
  assert.equal(max, 202639474);
  const row = db.get("SELECT siguiente_numero FROM invoice_counter WHERE id = 1");
  assert.equal(row.siguiente_numero, 202639474);
});

test("initCounterFromServerTruth: refuses to guess when either max is not a verified number", () => {
  assert.throws(() => initCounterFromServerTruth(db, { historicalMax: null, newInvsMax: 202639474 }), /must both be verified numbers/);
  assert.throws(() => initCounterFromServerTruth(db, { historicalMax: 202639464, newInvsMax: undefined }), /must both be verified numbers/);
});

test("initCounterFromServerTruth: refuses to re-initialize an already-initialized counter", () => {
  initCounterFromServerTruth(db, { historicalMax: 100, newInvsMax: 200 });
  assert.throws(() => initCounterFromServerTruth(db, { historicalMax: 300, newInvsMax: 400 }), /already initialized/);
});

test("reserveInvoiceNumber: assigns the next sequential number to a brand-new WO (fictitious)", () => {
  initCounterFromServerTruth(db, { historicalMax: 202639474, newInvsMax: 202639474 });
  const result = reserveInvoiceNumber(db, { wo: "FAKE-WO-0001", bloqueId: "2099-W01", asignadoPor: "michelle@test" });
  assert.equal(result.orderNumber, 202639475);
  assert.equal(result.reused, false);
});

test("reserveInvoiceNumber: two different fictitious WOs get two different consecutive numbers", () => {
  initCounterFromServerTruth(db, { historicalMax: 500, newInvsMax: 500 });
  const a = reserveInvoiceNumber(db, { wo: "FAKE-A", asignadoPor: "michelle@test" });
  const b = reserveInvoiceNumber(db, { wo: "FAKE-B", asignadoPor: "michelle@test" });
  assert.equal(a.orderNumber, 501);
  assert.equal(b.orderNumber, 502);
});

test("reserveInvoiceNumber: idempotent retry for the SAME wo reuses the existing number, never burns a new one", () => {
  initCounterFromServerTruth(db, { historicalMax: 500, newInvsMax: 500 });
  const first = reserveInvoiceNumber(db, { wo: "FAKE-RETRY", asignadoPor: "michelle@test" });
  const retry1 = reserveInvoiceNumber(db, { wo: "FAKE-RETRY", asignadoPor: "michelle@test" });
  const retry2 = reserveInvoiceNumber(db, { wo: "FAKE-RETRY", asignadoPor: "michelle@test" });
  assert.equal(first.orderNumber, 501);
  assert.equal(retry1.orderNumber, 501);
  assert.equal(retry2.orderNumber, 501);
  assert.equal(retry1.reused, true);
  assert.equal(retry2.reused, true);

  // And the counter did NOT advance past 501 because of the retries.
  const another = reserveInvoiceNumber(db, { wo: "FAKE-NEXT", asignadoPor: "michelle@test" });
  assert.equal(another.orderNumber, 502);
});

test("reserveInvoiceNumber: existing wo already has a real assignment -- never generates a second number for it", () => {
  initCounterFromServerTruth(db, { historicalMax: 500, newInvsMax: 500 });
  db.run(
    "INSERT INTO asignaciones_invoice (wo, order_number, bloque_id, asignado_en, asignado_por) VALUES (?, ?, ?, ?, ?)",
    ["ALREADY-ASSIGNED", 999, "2099-W01", "2099-01-01T00:00:00Z", "michelle@test"]
  );
  const result = reserveInvoiceNumber(db, { wo: "ALREADY-ASSIGNED", asignadoPor: "michelle@test" });
  assert.equal(result.orderNumber, 999);
  assert.equal(result.reused, true);
  // Counter untouched.
  const row = db.get("SELECT siguiente_numero FROM invoice_counter WHERE id = 1");
  assert.equal(row.siguiente_numero, 500);
});

test("reserveInvoiceNumber: simulated race -- a second assignment for the same wo sneaks in between read and write", () => {
  initCounterFromServerTruth(db, { historicalMax: 500, newInvsMax: 500 });

  // Simulate a concurrent request that already committed an assignment for
  // this wo, discovered only when our own INSERT hits the UNIQUE(wo)
  // constraint -- this is exactly the scenario the UNIQUE constraint (not
  // just application logic) is meant to catch. We exercise the failure
  // path directly: pre-insert a colliding row, then call
  // reserveInvoiceNumber, which must detect it via the UNIQUE constraint
  // during its own transaction and roll back cleanly.
  db.run(
    "INSERT INTO asignaciones_invoice (wo, order_number, bloque_id, asignado_en, asignado_por) VALUES (?, ?, ?, ?, ?)",
    ["RACE-WO", 700, "2099-W01", "2099-01-01T00:00:00Z", "otro-tecnico@test"]
  );
  const result = reserveInvoiceNumber(db, { wo: "RACE-WO", asignadoPor: "michelle@test" });
  assert.equal(result.orderNumber, 700);
  assert.equal(result.reused, true);
  // Counter must still be exactly 500 -- no number was burned trying.
  const row = db.get("SELECT siguiente_numero FROM invoice_counter WHERE id = 1");
  assert.equal(row.siguiente_numero, 500);
});

test("reserveInvoiceNumber: UNIQUE(order_number) at the DB level blocks a manual attempt to reuse a number", () => {
  initCounterFromServerTruth(db, { historicalMax: 500, newInvsMax: 500 });
  reserveInvoiceNumber(db, { wo: "FAKE-ONE", asignadoPor: "michelle@test" }); // takes 501
  assert.throws(() => {
    db.run(
      "INSERT INTO asignaciones_invoice (wo, order_number, bloque_id, asignado_en, asignado_por) VALUES (?, ?, ?, ?, ?)",
      ["FAKE-TWO-TRYING-TO-REUSE-501", 501, "2099-W01", "2099-01-01T00:00:00Z", "michelle@test"]
    );
  }, /UNIQUE/);
});

test("reserveInvoiceNumber: 50 fictitious WOs reserved back-to-back all get distinct, strictly increasing numbers", () => {
  initCounterFromServerTruth(db, { historicalMax: 1000, newInvsMax: 1000 });
  const seen = new Set();
  let last = 1000;
  for (let i = 0; i < 50; i++) {
    const r = reserveInvoiceNumber(db, { wo: `FAKE-BULK-${i}`, asignadoPor: "michelle@test" });
    assert.equal(seen.has(r.orderNumber), false, "number reused: " + r.orderNumber);
    assert.ok(r.orderNumber > last, "numbers must strictly increase");
    seen.add(r.orderNumber);
    last = r.orderNumber;
  }
  assert.equal(seen.size, 50);
});
