// Local-only validation of reserve-with-batch.js's SQL design, using the
// D1-shaped emulator (node:sqlite underneath). No network, no wrangler, no
// real D1 -- this is a logic sanity check BEFORE ever touching the real
// scratch D1, not a substitute for testing against it.
// Run with: node --test scratch/billing-batch-test/reserve-with-batch.local.test.js
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeD1Emulator } from "./d1-emulator.js";
import { reserveInvoiceNumberBatch } from "./reserve-with-batch.js";
import { resetFixtures, INITIAL_COUNTER } from "./reset-fixtures.js";

const schemaSql = readFileSync(new URL("../../sql/v001_crear_tablas_billing.sql", import.meta.url), "utf8");

let env;
beforeEach(async () => {
  env = { BILLING_DB: makeD1Emulator(schemaSql) };
  await resetFixtures(env);
});

test("reset-fixtures: counter starts at exactly 900000000, no assignments", async () => {
  const counter = await env.BILLING_DB.prepare("SELECT siguiente_numero FROM invoice_counter WHERE id = 1").first();
  assert.equal(counter.siguiente_numero, INITIAL_COUNTER);
  const { results } = await env.BILLING_DB.prepare("SELECT * FROM asignaciones_invoice").all();
  assert.equal(results.length, 0);
});

test("reserveInvoiceNumberBatch: first reservation gets exactly the initial value (900000000), not +1", async () => {
  const result = await reserveInvoiceNumberBatch(env, { wo: "BATCHTEST-WO-0001", asignadoPor: "scratch-test@example.invalid" });
  assert.equal(result.orderNumber, 900000000);
  assert.equal(result.reused, false);
  const counter = await env.BILLING_DB.prepare("SELECT siguiente_numero FROM invoice_counter WHERE id = 1").first();
  assert.equal(counter.siguiente_numero, 900000001);
});

test("reserveInvoiceNumberBatch: two different fictitious WOs get consecutive numbers, no gaps", async () => {
  const a = await reserveInvoiceNumberBatch(env, { wo: "BATCHTEST-WO-A", asignadoPor: "scratch-test@example.invalid" });
  const b = await reserveInvoiceNumberBatch(env, { wo: "BATCHTEST-WO-B", asignadoPor: "scratch-test@example.invalid" });
  assert.equal(a.orderNumber, 900000000);
  assert.equal(b.orderNumber, 900000001);
});

test("reserveInvoiceNumberBatch: idempotent retry for the SAME wo reuses the number, never burns a new one", async () => {
  const first = await reserveInvoiceNumberBatch(env, { wo: "BATCHTEST-RETRY", asignadoPor: "scratch-test@example.invalid" });
  const retry1 = await reserveInvoiceNumberBatch(env, { wo: "BATCHTEST-RETRY", asignadoPor: "scratch-test@example.invalid" });
  const retry2 = await reserveInvoiceNumberBatch(env, { wo: "BATCHTEST-RETRY", asignadoPor: "scratch-test@example.invalid" });
  assert.equal(first.orderNumber, 900000000);
  assert.equal(retry1.orderNumber, 900000000);
  assert.equal(retry2.orderNumber, 900000000);
  assert.equal(retry1.reused, true);
  assert.equal(retry2.reused, true);

  const next = await reserveInvoiceNumberBatch(env, { wo: "BATCHTEST-NEXT", asignadoPor: "scratch-test@example.invalid" });
  assert.equal(next.orderNumber, 900000001, "the counter must not have advanced because of the retries");
});

test("reserveInvoiceNumberBatch: simulated race -- a concurrent winner's row already exists when we reach the batch", async () => {
  // Pre-insert a colliding assignment directly (standing in for a
  // concurrent request that already completed its own reserve call for
  // this wo), matching the same scenario billing-db.test.js exercises
  // against node:sqlite directly.
  await env.BILLING_DB
    .prepare(
      "INSERT INTO asignaciones_invoice (wo, order_number, bloque_id, asignado_en, asignado_por) VALUES (?1, ?2, ?3, ?4, ?5)"
    )
    .bind("BATCHTEST-RACE-01", 900000000, "2099-W01", "2099-01-01T00:00:00Z", "otro-tecnico@example.invalid")
    .all();
  await env.BILLING_DB
    .prepare("UPDATE invoice_counter SET siguiente_numero = 900000001 WHERE id = 1")
    .bind()
    .all();

  const result = await reserveInvoiceNumberBatch(env, { wo: "BATCHTEST-RACE-01", asignadoPor: "scratch-test@example.invalid" });
  assert.equal(result.orderNumber, 900000000);
  assert.equal(result.reused, true);
  const counter = await env.BILLING_DB.prepare("SELECT siguiente_numero FROM invoice_counter WHERE id = 1").first();
  assert.equal(counter.siguiente_numero, 900000001, "counter must not advance a second time for a lost race");
});

test("reserveInvoiceNumberBatch: 50 fictitious WOs reserved back-to-back all get distinct, strictly increasing numbers", async () => {
  const seen = new Set();
  let last = INITIAL_COUNTER - 1;
  for (let i = 0; i < 50; i++) {
    const r = await reserveInvoiceNumberBatch(env, { wo: `BATCHTEST-BULK-${i}`, asignadoPor: "scratch-test@example.invalid" });
    assert.equal(seen.has(r.orderNumber), false, "number reused: " + r.orderNumber);
    assert.ok(r.orderNumber > last, "numbers must strictly increase");
    seen.add(r.orderNumber);
    last = r.orderNumber;
  }
  assert.equal(seen.size, 50);
  assert.equal(last, INITIAL_COUNTER + 49);
});

test("resetFixtures: wipes prior fictitious assignments and restores the counter to 900000000 between scenarios", async () => {
  await reserveInvoiceNumberBatch(env, { wo: "BATCHTEST-LEFTOVER", asignadoPor: "scratch-test@example.invalid" });
  await resetFixtures(env);
  const counter = await env.BILLING_DB.prepare("SELECT siguiente_numero FROM invoice_counter WHERE id = 1").first();
  assert.equal(counter.siguiente_numero, INITIAL_COUNTER);
  const { results } = await env.BILLING_DB.prepare("SELECT * FROM asignaciones_invoice").all();
  assert.equal(results.length, 0);
});
