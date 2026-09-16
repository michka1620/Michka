import { test } from "node:test";
import assert from "node:assert/strict";
import { toChicagoParts, computeBloque, resolverFechaServicio, ordenarBloque } from "./bloque-semanal.js";

// Helper: build a UTC instant for a given Chicago wall-clock time on a
// known date, using a fixed offset appropriate to that date's DST status,
// then verify via toChicagoParts that it round-trips -- this keeps the
// tests honest about what "Chicago time" they're actually asserting on.
// ss/ms default to 0 so existing minute-level call sites don't need to change.
function chicagoInstant(y, m, d, hh, mm, ss = 0, ms = 0, offsetHours) {
  return new Date(Date.UTC(y, m - 1, d, hh + offsetHours, mm, ss, ms));
}

test("toChicagoParts: correctly resolves weekday and time for a known UTC instant (CDT, -5)", () => {
  // 2026-09-16 (Wed) 11:30 AM Chicago (CDT, UTC-5) = 16:30 UTC.
  const instant = new Date("2026-09-16T16:30:00Z");
  const parts = toChicagoParts(instant);
  assert.equal(parts.weekday, "Wed");
  assert.equal(parts.hour, 11);
  assert.equal(parts.minute, 30);
  assert.equal(parts.year, 2026);
  assert.equal(parts.month, 9);
  assert.equal(parts.day, 16);
});

test("computeBloque: Thursday 00:01 Chicago belongs to the block starting that same Thursday", () => {
  const parts = toChicagoParts(chicagoInstant(2026, 9, 10, 0, 1, 0, 0, 5)); // Thu, CDT
  assert.equal(parts.weekday, "Thu");
  const bloque = computeBloque(parts);
  assert.equal(bloque.bloqueId, "2026-09-10");
  assert.equal(bloque.cierraEn, "2026-09-16");
});

test("computeBloque: Wednesday 11:59 AM Chicago (one minute before cutoff) still belongs to the closing block", () => {
  const parts = toChicagoParts(chicagoInstant(2026, 9, 16, 11, 59, 0, 0, 5)); // Wed, CDT
  const bloque = computeBloque(parts);
  assert.equal(bloque.cierraEn, "2026-09-16");
  assert.equal(bloque.bloqueId, "2026-09-10");
});

test("computeBloque: Wednesday exactly 12:00 PM Chicago still belongs to the closing block (cutoff is inclusive)", () => {
  const parts = toChicagoParts(chicagoInstant(2026, 9, 16, 12, 0, 0, 0, 5));
  const bloque = computeBloque(parts);
  assert.equal(bloque.cierraEn, "2026-09-16");
});

test("computeBloque: Wednesday 12:01 PM Chicago (one minute after cutoff) rolls to NEXT week's block", () => {
  const parts = toChicagoParts(chicagoInstant(2026, 9, 16, 12, 1, 0, 0, 5));
  const bloque = computeBloque(parts);
  assert.equal(bloque.cierraEn, "2026-09-23");
  assert.equal(bloque.bloqueId, "2026-09-17");
});

test("computeBloque: a Monday falls into the block that closes the Wednesday right after it", () => {
  const parts = toChicagoParts(chicagoInstant(2026, 9, 14, 15, 0, 0, 0, 5)); // Mon
  const bloque = computeBloque(parts);
  assert.equal(bloque.bloqueId, "2026-09-10");
  assert.equal(bloque.cierraEn, "2026-09-16");
});

test("computeBloque: caso de prueba 9124 -- servicio a las 12:00:00.001pm del miercoles (justo despues del corte) cae en el bloque SIGUIENTE, no en el que cierra", () => {
  // Este es el caso real que exponia el bug: a nivel de minuto, 12:00:00.001pm
  // es indistinguible de 12:00:00.000pm, asi que sin precision de segundos/ms
  // el motor lo dejaba (mal) en el bloque que cierra ese mismo miercoles.
  const wo9124 = toChicagoParts(chicagoInstant(2026, 9, 16, 12, 0, 0, 1, 5)); // Wed 12:00:00.001pm CDT
  const bloque = computeBloque(wo9124);
  assert.equal(bloque.bloqueId, "2026-09-17", "debe abrir el bloque siguiente (jueves)");
  assert.equal(bloque.cierraEn, "2026-09-23");
  assert.notEqual(bloque.cierraEn, "2026-09-16", "no debe mezclarse con el bloque que ya cerro al mediodia");
});

test("computeBloque: jueves de la semana SIGUIENTE al cierre tambien va al bloque siguiente (sin hueco)", () => {
  // El bloque actual cierra 2026-09-16 (mie). El jueves siguiente,
  // 2026-09-17, debe caer en el bloque que empieza ese mismo dia y cierra
  // el 2026-09-23 -- nunca mezclado con el bloque ya cerrado.
  const parts = toChicagoParts(chicagoInstant(2026, 9, 17, 9, 0, 0, 0, 5));
  const bloque = computeBloque(parts);
  assert.equal(bloque.bloqueId, "2026-09-17");
  assert.equal(bloque.cierraEn, "2026-09-23");
  assert.notEqual(bloque.bloqueId, "2026-09-10", "no debe mezclarse con el bloque ya cerrado");
});

test("computeBloque: miercoles 11:59:59am (un segundo antes del corte) sigue en el bloque que cierra", () => {
  const parts = toChicagoParts(chicagoInstant(2026, 9, 16, 11, 59, 59, 0, 5));
  const bloque = computeBloque(parts);
  assert.equal(bloque.cierraEn, "2026-09-16");
  assert.equal(bloque.bloqueId, "2026-09-10");
});

test("computeBloque: miercoles exactamente 12:00:00.000pm (el corte mismo) sigue en el bloque que cierra -- inclusivo", () => {
  const parts = toChicagoParts(chicagoInstant(2026, 9, 16, 12, 0, 0, 0, 5));
  const bloque = computeBloque(parts);
  assert.equal(bloque.cierraEn, "2026-09-16");
  assert.equal(bloque.bloqueId, "2026-09-10");
});

test("computeBloque: miercoles 4:00pm cae en el bloque siguiente (jueves-miercoles continuo, sin hueco)", () => {
  const parts = toChicagoParts(chicagoInstant(2026, 9, 16, 16, 0, 0, 0, 5));
  const bloque = computeBloque(parts);
  assert.equal(bloque.bloqueId, "2026-09-17");
  assert.equal(bloque.cierraEn, "2026-09-23");
});

test("computeBloque: jueves 12:00:00am (inicio del bloque) -- confirma que no hay hueco entre el corte del miercoles y el jueves", () => {
  // El bloque que cerro el miercoles 2026-09-16 al mediodia debe empalmar
  // exactamente con el bloque que arranca el jueves 2026-09-17 a las 00:00:
  // cualquier instante entre 12:00:00.001pm del miercoles y 12:00:00am del
  // jueves pertenece al mismo bloque siguiente, sin zona muerta.
  const parts = toChicagoParts(chicagoInstant(2026, 9, 17, 0, 0, 0, 0, 5));
  assert.equal(parts.weekday, "Thu");
  const bloque = computeBloque(parts);
  assert.equal(bloque.bloqueId, "2026-09-17");
  assert.equal(bloque.cierraEn, "2026-09-23");
});

test("computeBloque: DST transition -- clocks fall back (Nov 2026) does not shift the calendar-day boundary", () => {
  // Nov 1, 2026 is a Sunday; DST in the US ends Nov 1, 2026 at 2am local.
  // A Wednesday afterwards (Nov 4, CST, UTC-6) at 12:00 should still close
  // its own block correctly despite the offset change earlier that week.
  const parts = toChicagoParts(chicagoInstant(2026, 11, 4, 11, 59, 0, 0, 6)); // Wed, CST
  assert.equal(parts.weekday, "Wed");
  const bloque = computeBloque(parts);
  assert.equal(bloque.cierraEn, "2026-11-04");
  assert.equal(bloque.bloqueId, "2026-10-29");
});

test("computeBloque: DST transition -- clocks spring forward (Mar 2026, entra horario de verano) does not shift the cutoff", () => {
  // Mar 8, 2026 is a Sunday; DST in the US begins Mar 8, 2026 at 2am local
  // (clocks jump from CST/-6 to CDT/-5). The Wednesday that closes the
  // block containing that transition (Mar 11) must still cut off exactly
  // at its own local noon, in the new CDT offset.
  const antesDelCorte = toChicagoParts(chicagoInstant(2026, 3, 11, 11, 59, 59, 0, 5)); // Wed, CDT
  assert.equal(antesDelCorte.weekday, "Wed");
  const bloqueAntes = computeBloque(antesDelCorte);
  assert.equal(bloqueAntes.cierraEn, "2026-03-11");
  assert.equal(bloqueAntes.bloqueId, "2026-03-05");

  const despuesDelCorte = toChicagoParts(chicagoInstant(2026, 3, 11, 12, 0, 0, 1, 5)); // Wed 12:00:00.001pm CDT
  const bloqueDespues = computeBloque(despuesDelCorte);
  assert.equal(bloqueDespues.bloqueId, "2026-03-12");
  assert.equal(bloqueDespues.cierraEn, "2026-03-18");
});

test("resolverFechaServicio: prefers metadatos (EXIF) over aplicacion and foto", () => {
  const r = resolverFechaServicio([
    { fecha: "2026-09-15", hora: "14:00", origen: "foto" },
    { fecha: "2026-09-14", hora: "10:00", origen: "aplicacion" },
    { fecha: "2026-09-14", hora: "09:30", origen: "metadatos" },
  ]);
  assert.equal(r.fecha, "2026-09-14");
  assert.equal(r.hora, "09:30");
  assert.equal(r.origen, "metadatos");
});

test("resolverFechaServicio: multiple photos of the same WO with metadatos -- the earliest wins", () => {
  const r = resolverFechaServicio([
    { fecha: "2026-09-14", hora: "11:00", origen: "metadatos" },
    { fecha: "2026-09-14", hora: "08:15", origen: "metadatos" },
    { fecha: "2026-09-14", hora: "09:00", origen: "metadatos" },
  ]);
  assert.equal(r.hora, "08:15");
});

test("resolverFechaServicio: no hora present -- keeps the fecha, hora stays null (never invented)", () => {
  const r = resolverFechaServicio([{ fecha: "2026-09-14", hora: null, origen: "metadatos" }]);
  assert.equal(r.fecha, "2026-09-14");
  assert.equal(r.hora, null);
  assert.equal(r.origen, "metadatos");
});

test("resolverFechaServicio: no fecha at all -- 'sin_confirmar', never guesses a day", () => {
  const r = resolverFechaServicio([]);
  assert.equal(r.fecha, null);
  assert.equal(r.origen, "sin_confirmar");
});

test("resolverFechaServicio: candidates exist but none carry a recognized origen -- fails closed to sin_confirmar", () => {
  const r = resolverFechaServicio([{ fecha: "2026-09-14", hora: "10:00", origen: "quien-sabe" }]);
  assert.equal(r.fecha, null);
  assert.equal(r.origen, "sin_confirmar");
});

test("ordenarBloque: sorts by fecha, then hora, missing-hora goes to the end of that day", () => {
  const { listos, sinFecha } = ordenarBloque([
    { wo: "B", fecha: "2026-09-14", hora: "10:00" },
    { wo: "A", fecha: "2026-09-14", hora: null },
    { wo: "C", fecha: "2026-09-13", hora: "23:00" },
  ]);
  assert.deepEqual(listos.map((s) => s.wo), ["C", "B", "A"]);
  assert.equal(sinFecha.length, 0);
});

test("ordenarBloque: exact same fecha+hora tiebreaks by Customer WO", () => {
  const { listos } = ordenarBloque([
    { wo: "4920139200", fecha: "2026-09-15", hora: "08:00" },
    { wo: "4920138860", fecha: "2026-09-15", hora: "08:00" },
  ]);
  assert.deepEqual(listos.map((s) => s.wo), ["4920138860", "4920139200"]);
});

test("ordenarBloque: services without a fecha are set aside, never numbered/ordered with the rest", () => {
  const { listos, sinFecha } = ordenarBloque([
    { wo: "READY", fecha: "2026-09-14", hora: "10:00" },
    { wo: "NEEDS-DATE", fecha: null, hora: null },
  ]);
  assert.equal(listos.length, 1);
  assert.equal(sinFecha.length, 1);
  assert.equal(sinFecha[0].wo, "NEEDS-DATE");
});
