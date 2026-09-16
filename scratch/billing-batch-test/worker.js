// Minimal, throwaway Worker for testing BILLING_DB.batch() against a real
// D1 instance with fictitious data. Deliberately has NONE of the real
// app's surface: no Access/JWT auth, no ANTHROPIC_API_KEY, no ASSETS
// binding, no SUPREMEKV service binding -- only BILLING_DB plus a single
// static SCRATCH_TEST_TOKEN (from .dev.vars, never committed) required on
// every route. Never meant to be deployed to a public route -- run with
// `wrangler dev --ip 127.0.0.1 --remote` and hit it from localhost only.
import { reserveInvoiceNumberBatch } from "./reserve-with-batch.js";
import { resetFixtures } from "./reset-fixtures.js";

// Not cryptographically hardened (this is a throwaway local harness, not a
// real auth system) -- just avoids the most naive short-circuit string
// comparison so a mistyped token doesn't leak length via timing.
function timingSafeEqualStr(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function requireToken(request, env) {
  if (!env.SCRATCH_TEST_TOKEN) {
    return new Response("Server misconfigured: SCRATCH_TEST_TOKEN not set (check .dev.vars)", { status: 500 });
  }
  const provided = request.headers.get("X-Scratch-Test-Token");
  if (!timingSafeEqualStr(provided || "", env.SCRATCH_TEST_TOKEN)) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const authError = requireToken(request, env);
    if (authError) return authError;

    if (url.pathname === "/reset" && request.method === "POST") {
      const result = await resetFixtures(env);
      return Response.json(result);
    }

    if (url.pathname === "/reserve" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return new Response("Invalid JSON body", { status: 400 });
      }
      if (!body.wo || !body.asignadoPor) {
        return new Response("wo and asignadoPor are required", { status: 400 });
      }
      try {
        const result = await reserveInvoiceNumberBatch(env, {
          wo: body.wo,
          bloqueId: body.bloqueId || null,
          asignadoPor: body.asignadoPor,
        });
        return Response.json(result);
      } catch (e) {
        return new Response("Error: " + e.message, { status: 500 });
      }
    }

    if (url.pathname === "/state" && request.method === "GET") {
      const counter = await env.BILLING_DB.prepare("SELECT siguiente_numero FROM invoice_counter WHERE id = 1").first();
      const { results: asignaciones } = await env.BILLING_DB
        .prepare("SELECT wo, order_number, bloque_id, asignado_por FROM asignaciones_invoice ORDER BY order_number")
        .all();
      return Response.json({ counter, asignaciones });
    }

    return new Response("Not found. Endpoints: POST /reset, POST /reserve, GET /state", { status: 404 });
  },
};
