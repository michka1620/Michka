// Regression tests for the three invoice-save/duplicate-detection fixes in
// public/index.html (generateInvoiceNumber, saveInvoices, the isHistorical +
// new-invoice merge logic inside pullEditsFromKV).
//
// These tests extract the REAL function source straight out of
// public/index.html (by brace-matching from a known start marker) and eval
// it in a minimal stubbed environment, so they exercise the exact code that
// ships -- not a hand-copied approximation that could silently drift from it.
//
// Run with: node --test invoice-save-fix.test.mjs
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SOURCE = readFileSync(new URL("./public/index.html", import.meta.url), "utf8");

// Extracts one balanced-brace block starting at the first occurrence of
// `startMarker`, from the marker's own opening "{" through its matching "}".
function extractBlock(source, startMarker) {
  const idx = source.indexOf(startMarker);
  if (idx === -1) throw new Error("marker not found: " + startMarker);
  const braceStart = source.indexOf("{", idx);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(idx, i + 1);
    }
  }
  throw new Error("unbalanced braces for marker: " + startMarker);
}

const generateInvoiceNumberSrc = extractBlock(SOURCE, "function generateInvoiceNumber()");
const saveInvoicesSrc = extractBlock(SOURCE, "const saveInvoices = function(all)").replace(
  "const saveInvoices = function(all)",
  "function saveInvoicesImpl(all)"
);
// The isHistorical()+merge block lives inline inside pullEditsFromKV's fetch
// .then() callback. Extract from the histKeys declaration through the
// mergedNew assignment, and wrap it as a standalone function of
// (HISTORICAL_DATA, kvNew, localNew) -> mergedNew, avoiding any need to stub
// fetch/promises to exercise this logic.
const mergeStart = "// Filter out any entry that IS a historical record";
const mergeEndMarker = "var mergedNew = Object.values(mergedNewMap);";
const mergeStartIdx = SOURCE.indexOf(mergeStart);
const mergeEndIdx = SOURCE.indexOf(mergeEndMarker, mergeStartIdx) + mergeEndMarker.length;
if (mergeStartIdx === -1 || mergeEndIdx === -1) throw new Error("merge block markers not found");
const mergeBlockSrc = SOURCE.slice(mergeStartIdx, mergeEndIdx);

function buildEnv({ historicalData = [], invoices = [], showToastCalls = [] } = {}) {
  const store = {};
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  const HISTORICAL_DATA = historicalData;
  const getInvoices = () => invoices;
  const showToast = (msg, isError) => showToastCalls.push({ msg, isError });
  let lastPush = null;
  const pushEditsToKV = (edits, deleted, newInvs) => { lastPush = { edits, deleted, newInvs }; };
  const ctx = { HISTORICAL_DATA, getInvoices, showToast, pushEditsToKV, localStorage };
  const fn = new Function(
    "HISTORICAL_DATA", "getInvoices", "showToast", "pushEditsToKV", "localStorage",
    generateInvoiceNumberSrc + "\n" + saveInvoicesSrc + "\nreturn { generateInvoiceNumber, saveInvoicesImpl };"
  );
  const { generateInvoiceNumber, saveInvoicesImpl } = fn(
    ctx.HISTORICAL_DATA, ctx.getInvoices, ctx.showToast, ctx.pushEditsToKV, ctx.localStorage
  );
  return { generateInvoiceNumber, saveInvoices: saveInvoicesImpl, getLastPush: () => lastPush, store, showToastCalls };
}

function runMerge(historicalData, kvNew, localNew) {
  const fn = new Function(
    "HISTORICAL_DATA", "kvNew", "localNew",
    mergeBlockSrc + "\nreturn mergedNew;"
  );
  return fn(historicalData, kvNew, localNew);
}

function blankInvoice(overrides) {
  return Object.assign({
    number: "", wo: "", date: "2026-09-22", total: 0, totalLabor: 0, totalMaterial: 0,
    status: "PENDING", payment: "", sentState: 0, newFormat: true, area: "",
    notes: "", partsGeneral: "", tirePositions: [], expenses: [],
    tech: { name: "Danny" }, vehicle: {}, client: { company: "Test Client" },
    createdAt: new Date().toISOString(),
  }, overrides);
}

describe("generateInvoiceNumber", () => {
  test("never generates a number in the WO# range (49xxxxxxxx) -- old bug", () => {
    const { generateInvoiceNumber } = buildEnv({ historicalData: [], invoices: [] });
    const n = Number(generateInvoiceNumber());
    assert.ok(n > 202000000 && n < 210000000, `expected Order# range, got ${n}`);
    assert.ok(!(n > 4900000000 && n < 5000000000), `must not land in WO# range, got ${n}`);
  });

  test("skips any number already used by a historical record's number OR wo", () => {
    const historicalData = [
      blankInvoice({ number: "202639300", wo: "4920139999" }),
      blankInvoice({ number: "202639301", wo: "" }),
    ];
    const { generateInvoiceNumber } = buildEnv({ historicalData, invoices: [] });
    const n = Number(generateInvoiceNumber());
    assert.equal(n, 202639302);
  });
});

describe("saveInvoices -- new invoice preserved / duplicate detection", () => {
  test("scenario 1: a genuinely new invoice is kept in newInvs, not dropped", () => {
    const historicalData = [blankInvoice({ number: "202600001", wo: "4920100001" })];
    const env = buildEnv({ historicalData, invoices: [] });
    const newInv = blankInvoice({ number: "202699999", wo: "4920199999" });
    env.saveInvoices(historicalData.concat([newInv]));
    const push = env.getLastPush();
    assert.equal(push.newInvs.length, 1);
    assert.equal(push.newInvs[0].wo, "4920199999");
  });

  test("scenario 2: a new invoice's number coincidentally matching a historical NUMBER does not make it vanish (old bug reproduction)", () => {
    // This exact collision is what the old generateInvoiceNumber() could produce
    // (WO#-range numbers colliding with a historical `number`), and what the old
    // saveInvoices() silently dropped via the number-alone exclusion.
    const historicalData = [blankInvoice({ number: "4920177777", wo: "" })];
    const env = buildEnv({ historicalData, invoices: [] });
    const collidingNewInv = blankInvoice({ number: "4920177777", wo: "4920188888" });
    env.saveInvoices(historicalData.concat([collidingNewInv]));
    const push = env.getLastPush();
    assert.equal(push.newInvs.length, 1, "the new invoice must survive despite the number collision");
    assert.equal(push.newInvs[0].wo, "4920188888");
  });

  test("scenario 3: a true duplicate WO# is detected, blocked, and reported (not silently dropped)", () => {
    const historicalData = [blankInvoice({ number: "202600001", wo: "4920100001" })];
    const env = buildEnv({ historicalData, invoices: [] });
    const dupOfHistorical = blankInvoice({ number: "202699998", wo: "4920100001" }); // same wo as historical record
    env.saveInvoices(historicalData.concat([dupOfHistorical]));
    const push = env.getLastPush();
    assert.equal(push.newInvs.length, 0, "duplicate WO# must not be pushed as new");
    assert.equal(env.showToastCalls.length, 1, "user must be told why it was not saved");
    assert.match(env.showToastCalls[0].msg, /duplicado/);
    assert.equal(env.showToastCalls[0].isError, true);
  });

  test("scenario 3b: two new invoices in the same save sharing a WO# -- second is blocked with a warning", () => {
    const env = buildEnv({ historicalData: [], invoices: [] });
    const first = blankInvoice({ number: "202699001", wo: "4920155555" });
    const second = blankInvoice({ number: "202699002", wo: "4920155555" });
    env.saveInvoices([first, second]);
    const push = env.getLastPush();
    assert.equal(push.newInvs.length, 1);
    assert.equal(env.showToastCalls.length, 1);
  });

  test("scenario 5a: editing a historical record's wo still produces an edit, not a phantom new invoice", () => {
    const historicalData = [blankInvoice({ number: "202600050", wo: "4920100050", notes: "original" })];
    const env = buildEnv({ historicalData, invoices: [] });
    const edited = Object.assign({}, historicalData[0], { wo: "4920100050-CORRECTED" });
    env.saveInvoices([edited]);
    const push = env.getLastPush();
    assert.equal(push.newInvs.length, 0, "an edited historical record must not become a new invoice");
    assert.ok(push.edits["202600050|4920100050"], "the edit must be recorded against the original key");
  });
});

describe("isHistorical() / pullEditsFromKV merge -- visibility after reload", () => {
  test("scenario 1: a genuinely new saved invoice stays visible after the merge", () => {
    const historicalData = [blankInvoice({ number: "202600001", wo: "4920100001" })];
    const newInv = blankInvoice({ number: "202699999", wo: "4920199999" });
    const merged = runMerge(historicalData, [newInv], []);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].wo, "4920199999");
  });

  test("scenario 4 (old bug reproduction): a new invoice whose wo matches a historical NUMBER is no longer hidden", () => {
    // Old isHistorical() treated `w && histNums.has(w)` as historical -- a
    // brand-new invoice whose wo happened to equal a historical `number`
    // value vanished from every screen on reload even though it was saved.
    const historicalData = [blankInvoice({ number: "4920177777", wo: "" })];
    const newInv = blankInvoice({ number: "202699999", wo: "4920177777" });
    const merged = runMerge(historicalData, [newInv], []);
    assert.equal(merged.length, 1, "must remain visible after reload despite the cross-field coincidence");
  });

  test("scenario 5b: historical records are still correctly excluded from newInvs (no phantom duplicates)", () => {
    const historicalData = [blankInvoice({ number: "202600001", wo: "4920100001" })];
    // Simulate a stale KV row that is literally the historical record itself.
    const staleHistoricalCopy = blankInvoice({ number: "202600001", wo: "4920100001" });
    const merged = runMerge(historicalData, [staleHistoricalCopy], []);
    assert.equal(merged.length, 0, "an exact historical number|wo pair must still be filtered out");
  });
});
