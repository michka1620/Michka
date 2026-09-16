// Wipes and reseeds fictitious data in the scratch D1, so every test
// scenario starts from a known, clean state. Only ever touches the 4
// billing tables inside the SCRATCH database this harness is bound to
// (tmp-billing-batch-scratch) -- never the real BILLING_DB.
//
// siguiente_numero starts at 900000000 (an obviously-fictitious value, far
// outside the real Order# range ~202639xxx) and represents the NEXT
// available number per the approved semantics: the first reservation gets
// exactly 900000000.
const INITIAL_COUNTER = 900000000;

async function resetFixtures(env) {
  await env.BILLING_DB.batch([
    env.BILLING_DB.prepare("DELETE FROM asignaciones_invoice"),
    env.BILLING_DB.prepare("DELETE FROM audit_log"),
    env.BILLING_DB.prepare("DELETE FROM fecha_servicio"),
    env.BILLING_DB.prepare("DELETE FROM invoice_counter"),
    env.BILLING_DB.prepare("INSERT INTO invoice_counter (id, siguiente_numero) VALUES (1, ?1)").bind(INITIAL_COUNTER),
  ]);
  return { ok: true, initialCounter: INITIAL_COUNTER };
}

export { resetFixtures, INITIAL_COUNTER };
