// NOT EXECUTED YET. This script is meant to run LATER, once the scratch D1
// (tmp-billing-batch-scratch) exists, its database_id is filled into
// wrangler.local.toml, and a local `wrangler dev` is running against it
// with --remote (so it talks to the real, but disposable, D1 in the cloud).
//
// How to run it (reference only -- do not run before the D1 is approved
// and created):
//   1) In one terminal, from the repo root:
//        npx wrangler -c scratch/billing-batch-test/wrangler.local.toml \
//          dev --remote --ip 127.0.0.1
//      (uses the LOCAL, gitignored config; binds BILLING_DB to
//      tmp-billing-batch-scratch; not deployed anywhere, just local dev
//      server proxying to the real scratch D1; .dev.vars in the same
//      directory supplies SCRATCH_TEST_TOKEN to the Worker)
//   2) In another terminal, from the repo root:
//        SCRATCH_TEST_TOKEN=<same value as in .dev.vars> \
//          node scratch/billing-batch-test/run-concurrency-tests.mjs
//
// Talks only to http://127.0.0.1:8787 (wrangler dev's default local port).
// Never touches production or supreme-autopro-pro-staging -- there is no
// code path here that can reach them (no URL for them is ever referenced).
//
// The token is read from the environment and used only as a request
// header value -- it is never logged, never included in an error message,
// and never written anywhere by this script.

const BASE_URL = process.env.BATCH_TEST_URL || "http://127.0.0.1:8787";

const SCRATCH_TEST_TOKEN = process.env.SCRATCH_TEST_TOKEN;
if (!SCRATCH_TEST_TOKEN) {
  console.error("SCRATCH_TEST_TOKEN env var is required (same value as scratch/billing-batch-test/.dev.vars). Not printing it, just checking it's set.");
  process.exit(1);
}
const AUTH_HEADERS = { "X-Scratch-Test-Token": SCRATCH_TEST_TOKEN };

async function reset() {
  const res = await fetch(`${BASE_URL}/reset`, { method: "POST", headers: AUTH_HEADERS });
  if (!res.ok) throw new Error(`reset failed (${res.status}): ` + (await res.text()));
  return res.json();
}

async function reserve(wo, asignadoPor = "scratch-test@example.invalid") {
  const res = await fetch(`${BASE_URL}/reserve`, {
    method: "POST",
    headers: { ...AUTH_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ wo, asignadoPor, bloqueId: "2099-W01" }),
  });
  if (!res.ok) throw new Error(`reserve(${wo}) failed (${res.status}): ` + (await res.text()));
  return res.json();
}

async function state() {
  const res = await fetch(`${BASE_URL}/state`, { headers: AUTH_HEADERS });
  if (!res.ok) throw new Error(`state failed (${res.status}): ` + (await res.text()));
  return res.json();
}

function assert(cond, message) {
  if (!cond) throw new Error("ASSERTION FAILED: " + message);
}

// Scenario 1: N concurrent requests for the SAME wo -- exactly one must
// win (reused:false), the rest must reuse its number, and the counter
// must advance by exactly 1, not N.
async function scenarioSameWo(concurrency = 30) {
  console.log(`\n=== Escenario 1: ${concurrency} requests concurrentes para el MISMO wo ===`);
  await reset();
  const wo = "BATCHTEST-RACE-01";
  const results = await Promise.all(Array.from({ length: concurrency }, () => reserve(wo)));

  const winners = results.filter((r) => r.reused === false);
  const losers = results.filter((r) => r.reused === true);
  console.log(`  winners=${winners.length} losers=${losers.length}`);
  assert(winners.length === 1, `exactamente 1 ganador esperado, hubo ${winners.length}`);
  assert(losers.length === concurrency - 1, "todos los demas deben ser reused:true");

  const distinctNumbers = new Set(results.map((r) => r.orderNumber));
  assert(distinctNumbers.size === 1, `todos deben compartir el mismo numero, hubo ${distinctNumbers.size} distintos`);

  const { counter } = await state();
  assert(counter.siguiente_numero === 900000001, `contador debe avanzar exactamente 1 (900000001), quedo en ${counter.siguiente_numero}`);
  console.log("  OK: un solo numero emitido, contador avanzo exactamente 1.");
}

// Scenario 2: N concurrent requests for N DISTINCT wos -- all numbers must
// be distinct and, once sorted, strictly sequential with no gaps.
async function scenarioDistinctWos(concurrency = 50) {
  console.log(`\n=== Escenario 2: ${concurrency} requests concurrentes para wos DISTINTOS ===`);
  await reset();
  const wos = Array.from({ length: concurrency }, (_, i) => `BATCHTEST-BULK-${i}`);
  const results = await Promise.all(wos.map((wo) => reserve(wo)));

  const numbers = results.map((r) => r.orderNumber).sort((a, b) => a - b);
  const distinct = new Set(numbers);
  assert(distinct.size === concurrency, `esperaba ${concurrency} numeros distintos, hubo ${distinct.size}`);
  for (let i = 1; i < numbers.length; i++) {
    assert(numbers[i] === numbers[i - 1] + 1, `hueco detectado entre ${numbers[i - 1]} y ${numbers[i]}`);
  }
  assert(numbers[0] === 900000000, `el primero debe ser 900000000, fue ${numbers[0]}`);
  console.log(`  OK: ${concurrency} numeros distintos y consecutivos, de ${numbers[0]} a ${numbers[numbers.length - 1]}.`);
}

// Scenario 3: idempotencia por reintento de red -- 3 llamadas SECUENCIALES
// (no concurrentes) para el mismo wo, simulando un cliente que reintenta
// tras un timeout aunque el servidor ya haya procesado la primera.
async function scenarioSequentialRetries() {
  console.log("\n=== Escenario 3: reintentos secuenciales (idempotencia de cliente) ===");
  await reset();
  const wo = "BATCHTEST-RETRY-01";
  const first = await reserve(wo);
  const retry1 = await reserve(wo);
  const retry2 = await reserve(wo);
  assert(first.reused === false, "la primera llamada debe ganar");
  assert(retry1.reused === true && retry2.reused === true, "los reintentos deben ser reused:true");
  assert(
    first.orderNumber === retry1.orderNumber && retry1.orderNumber === retry2.orderNumber,
    "las 3 llamadas deben devolver el mismo numero"
  );
  const { counter } = await state();
  assert(counter.siguiente_numero === 900000001, "el contador no debe avanzar por los reintentos");
  console.log(`  OK: numero estable en ${first.orderNumber} a traves de 3 llamadas.`);
}

async function main() {
  await scenarioSameWo();
  await scenarioDistinctWos();
  await scenarioSequentialRetries();
  console.log("\nTodos los escenarios de concurrencia/idempotencia pasaron.");
}

main().catch((e) => {
  console.error("\nFALLO:", e.message);
  process.exit(1);
});
