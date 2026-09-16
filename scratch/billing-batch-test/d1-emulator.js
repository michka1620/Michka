// Minimal local stand-in for the D1 binding's JS shape
// (prepare().bind().first()/.all(), db.batch([...])), backed by Node's
// built-in SQLite. This is ONLY for validating reserve-with-batch.js's SQL
// logic locally, with zero network/cloud access -- it is NOT a claim that
// it reproduces D1's exact runtime behavior (see the caveat this whole
// harness exists to resolve). Real D1 must still be tested separately.
//
// IMPORTANT: this emulator's own .batch() implementation uses
// BEGIN/COMMIT internally to fake D1's "sequential statements in one
// implicit transaction" behavior for local testing purposes -- that is
// this FAKE's plumbing, not something reserve-with-batch.js itself is
// allowed to do (it only ever calls .prepare()/.bind()/.batch()/.first()/.all()).
import { DatabaseSync } from "node:sqlite";

function wrapStatement(raw, sql) {
  let boundArgs = [];
  return {
    bind(...args) {
      boundArgs = args;
      return this;
    },
    async first() {
      const row = raw.prepare(sql).get(...boundArgs);
      return row === undefined ? null : row;
    },
    async all() {
      const rows = raw.prepare(sql).all(...boundArgs);
      return { results: rows };
    },
    _run() {
      // Used only from inside batch(): mimics D1's per-statement result
      // shape ({ results, meta: { changes } }) for both SELECT/RETURNING
      // and write statements.
      const stmt = raw.prepare(sql);
      const isSelectLike = /^\s*(SELECT|INSERT.*RETURNING|UPDATE.*RETURNING)/is.test(sql);
      if (isSelectLike && /^\s*SELECT/i.test(sql)) {
        const rows = stmt.all(...boundArgs);
        return { results: rows, meta: { changes: rows.length } };
      }
      const info = stmt.run(...boundArgs);
      return { results: [], meta: { changes: info.changes } };
    },
  };
}

function makeD1Emulator(schemaSql) {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schemaSql);
  return {
    prepare(sql) {
      return wrapStatement(raw, sql);
    },
    async batch(stmts) {
      raw.exec("BEGIN IMMEDIATE");
      try {
        const results = stmts.map((s) => s._run());
        raw.exec("COMMIT");
        return results;
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
    _raw: raw,
  };
}

export { makeD1Emulator };
