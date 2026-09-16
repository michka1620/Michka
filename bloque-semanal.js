// Weekly billing block logic: resolves a service's date/time with
// provenance, normalizes to America/Chicago, decides which block
// (Thursday 00:00 -> next Wednesday 12:00, Chicago time) it belongs to,
// and sorts a block's items chronologically for numbering/the PDF.

const CHICAGO_TZ = "America/Chicago";
const ORIGENES = ["foto", "metadatos", "aplicacion", "manual", "sin_confirmar"];

function toChicagoParts(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    weekday: "short", hour12: false,
  });
  const parts = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  // hour12:false can render midnight as "24" in some ICU builds -- normalize.
  let hour = parseInt(parts.hour, 10);
  if (hour === 24) hour = 0;
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    hour,
    minute: parseInt(parts.minute, 10),
    // Seconds come from the same Chicago-local formatter; milliseconds are
    // timezone-invariant (IANA offsets are always whole minutes), so they
    // can be read directly off the instant. Both are needed so the noon
    // cutoff below can tell 12:00:00.000 apart from 12:00:00.001.
    second: parseInt(parts.second, 10),
    millisecond: date.getUTCMilliseconds(),
    weekday: parts.weekday, // "Thu", "Wed", etc.
  };
}

// Calendar-date arithmetic only (adding/subtracting whole days) -- safe
// regardless of DST because we never reason about exact instants here,
// only about which calendar day something falls on in Chicago's calendar.
function addDaysToDateOnly(year, month, day, delta) {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + delta);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function pad2(n) { return String(n).padStart(2, "0"); }
function dateOnlyId({ year, month, day }) { return `${year}-${pad2(month)}-${pad2(day)}`; }

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Given Chicago wall-clock parts, returns { bloqueId, cierraEn } where
// bloqueId is the block's Thursday-start date (YYYY-MM-DD) and cierraEn
// is the block's Wednesday-close date (YYYY-MM-DD), both in Chicago local
// calendar terms. The cutoff instant is Wednesday 12:00 PM Chicago.
function computeBloque(chicagoParts) {
  const dow = WEEKDAY_INDEX[chicagoParts.weekday];
  if (dow === undefined) throw new Error("Unrecognized weekday: " + chicagoParts.weekday);

  // Days until (and including) the next Wednesday, treating "today is
  // Wednesday" as delta 0.
  const daysUntilWednesday = (3 - dow + 7) % 7;
  let closeDate = addDaysToDateOnly(chicagoParts.year, chicagoParts.month, chicagoParts.day, daysUntilWednesday);

  // If today IS the closing Wednesday and it's already STRICTLY past
  // 12:00:00.000 (the cutoff itself is inclusive -- exactly noon still
  // belongs to the closing block; 12:00:00.001 onward rolls over), this
  // moment rolls to NEXT week's block. Must compare down to the
  // millisecond -- comparing only hour/minute would wrongly keep the
  // whole 12:00:00.000-12:00:59.999 window in the closing block.
  const pastCutoff =
    chicagoParts.hour > 12 ||
    (chicagoParts.hour === 12 &&
      (chicagoParts.minute > 0 || chicagoParts.second > 0 || chicagoParts.millisecond > 0));
  if (daysUntilWednesday === 0 && pastCutoff) {
    closeDate = addDaysToDateOnly(closeDate.year, closeDate.month, closeDate.day, 7);
  }

  const startDate = addDaysToDateOnly(closeDate.year, closeDate.month, closeDate.day, -6); // Wednesday - 6 = Thursday

  return { bloqueId: dateOnlyId(startDate), cierraEn: dateOnlyId(closeDate) };
}

// Resolves the (fecha, hora, origen) for one service from its candidate
// sources, following the approved priority order. Never invents a value.
//
// candidatos: array of { fecha, hora, origen } in priority order already
// (metadatos > aplicacion > foto), or pass raw per-photo candidates and
// this picks the earliest metadatos/aplicacion timestamp per the "several
// photos of the same WO -> earliest wins" rule.
function resolverFechaServicio(candidatos) {
  if (!candidatos || candidatos.length === 0) {
    return { fecha: null, hora: null, origen: "sin_confirmar" };
  }

  const conFecha = candidatos.filter((c) => c.fecha);
  if (conFecha.length === 0) {
    return { fecha: null, hora: null, origen: "sin_confirmar" };
  }

  // Prefer the highest-priority origen present; within that origen, if
  // several photos of the same WO have it, take the earliest.
  for (const origen of ["metadatos", "aplicacion", "foto"]) {
    const enEseOrigen = conFecha.filter((c) => c.origen === origen);
    if (enEseOrigen.length === 0) continue;
    const conHora = enEseOrigen.filter((c) => c.hora);
    const pool = conHora.length > 0 ? conHora : enEseOrigen;
    pool.sort((a, b) => `${a.fecha}T${a.hora || "23:59"}`.localeCompare(`${b.fecha}T${b.hora || "23:59"}`));
    const winner = pool[0];
    return { fecha: winner.fecha, hora: winner.hora || null, origen };
  }

  // conFecha has entries but none tagged with a recognized origen -- fail
  // closed rather than guess which one to trust.
  return { fecha: null, hora: null, origen: "sin_confirmar" };
}

// Sorts a block's resolved services: by fecha asc, then hora asc (missing
// hora sorts to the end of that day), then wo as the final tiebreaker.
// Items with fecha === null (sin_confirmar) are returned separately since
// they must never receive a number or appear in the PDF until confirmed.
function ordenarBloque(servicios) {
  const listos = servicios.filter((s) => s.fecha);
  const sinFecha = servicios.filter((s) => !s.fecha);
  listos.sort((a, b) => {
    if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
    const horaA = a.hora || "99:99"; // no hora -> end of that day
    const horaB = b.hora || "99:99";
    if (horaA !== horaB) return horaA < horaB ? -1 : 1;
    return String(a.wo).localeCompare(String(b.wo));
  });
  return { listos, sinFecha };
}

export { toChicagoParts, computeBloque, resolverFechaServicio, ordenarBloque, ORIGENES, CHICAGO_TZ };
