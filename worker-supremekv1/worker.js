// Source for the "supremekv1" Cloudflare Worker (the invoice-sync backend).
// Deployed manually via the Cloudflare dashboard (Workers & Pages -> supremekv1 ->
// Edit code) — there is no CI pipeline for it, unlike the frontend Worker.
//
// Bindings required (Settings -> Variables and Bindings):
//   - D1 database bound as "SUPREME_DB" (run schema.sql on it once, see that file)
//   - Environment variable/secret "SYNC_KEY" — must match the SYNC_KEY constant
//     in index.html's client code.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    function json(obj, status) {
      return new Response(JSON.stringify(obj), { status: status || 200, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }
    function checkAuth() {
      return request.headers.get('x-api-key') === env.SYNC_KEY;
    }

    if (url.pathname === '/debug-sync-key') {
      const raw = env.SYNC_KEY || '';
      return json({ present: !!env.SYNC_KEY, length: raw.length, trimmedLength: raw.trim().length, firstChar: raw[0] || null, lastChar: raw[raw.length-1] || null });
    }

    // One-time recovery: read whatever is still sitting in the old KV store
    // (from before the D1 migration) and merge it into D1 without wiping
    // anything already in D1. Safe to call more than once.
    if (url.pathname === '/migrate-from-kv') {
      if (!checkAuth()) return new Response('Unauthorized', { status: 401, headers: cors });
      if (!env.SUPREME_KV) return json({ error: 'SUPREME_KV binding not found' }, 400);
      const rawEdits = await env.SUPREME_KV.get('invoiceEdits');
      const rawSent = await env.SUPREME_KV.get('sentStates');
      const old = rawEdits ? JSON.parse(rawEdits) : {};
      const oldSent = rawSent ? JSON.parse(rawSent) : {};
      const now = Date.now();
      const stmts = [];

      const edits = old.edits || {};
      const deleted = Array.isArray(old.deleted) ? old.deleted : [];
      const newInvs = Array.isArray(old.newInvs) ? old.newInvs : [];

      for (const key of Object.keys(edits)) {
        stmts.push(env.SUPREME_DB.prepare(
          `INSERT INTO edits (key, diff, updated_at) VALUES (?1, ?2, ?3)
           ON CONFLICT(key) DO UPDATE SET diff=excluded.diff, updated_at=excluded.updated_at
           WHERE excluded.updated_at >= edits.updated_at`
        ).bind(key, JSON.stringify(edits[key]), now));
      }
      for (const key of deleted) {
        stmts.push(env.SUPREME_DB.prepare(
          `INSERT INTO deleted_keys (key, deleted_at) VALUES (?1, ?2) ON CONFLICT(key) DO NOTHING`
        ).bind(key, now));
      }
      const deletedSet = new Set(deleted);
      for (const inv of newInvs) {
        const key = String(inv.number) + '|' + String(inv.wo || '');
        if (deletedSet.has(key)) continue;
        stmts.push(env.SUPREME_DB.prepare(
          `INSERT INTO new_invoices (key, data, updated_at) VALUES (?1, ?2, ?3)
           ON CONFLICT(key) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at
           WHERE excluded.updated_at >= new_invoices.updated_at`
        ).bind(key, JSON.stringify(inv), now));
      }
      for (const key of Object.keys(oldSent)) {
        stmts.push(env.SUPREME_DB.prepare(
          `INSERT INTO sent_states (key, state, updated_at) VALUES (?1, ?2, ?3)
           ON CONFLICT(key) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at
           WHERE excluded.updated_at >= sent_states.updated_at`
        ).bind(key, oldSent[key], now));
      }

      if (stmts.length) await env.SUPREME_DB.batch(stmts);
      return json({
        status: 'ok',
        foundInKV: { edits: Object.keys(edits).length, deleted: deleted.length, newInvs: newInvs.length, sent: Object.keys(oldSent).length },
      });
    }

    if (url.pathname === '/edits') {
      if (request.method === 'GET') {
        const [editRows, delRows, newRows] = await Promise.all([
          env.SUPREME_DB.prepare('SELECT key, diff FROM edits').all(),
          env.SUPREME_DB.prepare('SELECT key FROM deleted_keys').all(),
          env.SUPREME_DB.prepare('SELECT data FROM new_invoices').all(),
        ]);
        const edits = {};
        for (const row of editRows.results) { try { edits[row.key] = JSON.parse(row.diff); } catch(e) {} }
        const deleted = delRows.results.map(r => r.key);
        const newInvs = [];
        for (const row of newRows.results) { try { newInvs.push(JSON.parse(row.data)); } catch(e) {} }
        return json({ edits, deleted, newInvs });
      }
      if (request.method === 'POST') {
        if (!checkAuth()) return new Response('Unauthorized', { status: 401, headers: cors });
        let body;
        try { body = JSON.parse(await request.text()); } catch(e) { return new Response('Bad JSON', { status: 400, headers: cors }); }

        if (body.wipeAll === true) {
          await env.SUPREME_DB.batch([
            env.SUPREME_DB.prepare('DELETE FROM edits'),
            env.SUPREME_DB.prepare('DELETE FROM deleted_keys'),
            env.SUPREME_DB.prepare('DELETE FROM new_invoices'),
          ]);
          return json({ status: 'ok', wiped: true });
        }

        // Surgical undelete: remove specific keys from deleted_keys without
        // touching anything else (used to recover from an accidental bulk
        // delete where the invoice data itself was already restored but its
        // key was left behind in deleted_keys, hiding it from every client).
        if (Array.isArray(body.undeleteKeys) && body.undeleteKeys.length) {
          const stmts = body.undeleteKeys.map(key =>
            env.SUPREME_DB.prepare('DELETE FROM deleted_keys WHERE key = ?1').bind(key)
          );
          await env.SUPREME_DB.batch(stmts);
          return json({ status: 'ok', undeleted: body.undeleteKeys.length });
        }

        const edits = body.edits || {};
        const deleted = Array.isArray(body.deleted) ? body.deleted : [];
        const newInvs = Array.isArray(body.newInvs) ? body.newInvs : [];
        const now = Date.now();
        const stmts = [];

        // Each invoice is its own row, upserted individually (never a full-table
        // replace) — so two devices saving different invoices at the same time
        // can no longer clobber each other. The WHERE guard on the DO UPDATE makes
        // genuinely concurrent edits to the SAME invoice resolve by newest-wins.
        for (const key of Object.keys(edits)) {
          const entry = edits[key];
          const diff = (entry && typeof entry === 'object' && 'diff' in entry) ? entry.diff : entry;
          const updatedAt = (entry && entry.updatedAt) || now;
          stmts.push(env.SUPREME_DB.prepare(
            `INSERT INTO edits (key, diff, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET diff=excluded.diff, updated_at=excluded.updated_at
             WHERE excluded.updated_at >= edits.updated_at`
          ).bind(key, JSON.stringify(diff), updatedAt));
        }

        for (const key of deleted) {
          stmts.push(env.SUPREME_DB.prepare(
            `INSERT INTO deleted_keys (key, deleted_at) VALUES (?1, ?2) ON CONFLICT(key) DO NOTHING`
          ).bind(key, now));
          stmts.push(env.SUPREME_DB.prepare(`DELETE FROM edits WHERE key = ?1`).bind(key));
          stmts.push(env.SUPREME_DB.prepare(`DELETE FROM new_invoices WHERE key = ?1`).bind(key));
        }

        const deletedSet = new Set(deleted);
        for (const inv of newInvs) {
          const key = String(inv.number) + '|' + String(inv.wo || '');
          if (deletedSet.has(key)) continue;
          const updatedAt = inv._updatedAt || now;
          const clean = Object.assign({}, inv);
          delete clean._updatedAt;
          stmts.push(env.SUPREME_DB.prepare(
            `INSERT INTO new_invoices (key, data, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at
             WHERE excluded.updated_at >= new_invoices.updated_at`
          ).bind(key, JSON.stringify(clean), updatedAt));
        }

        if (stmts.length) await env.SUPREME_DB.batch(stmts);
        return json({ status: 'ok' });
      }
    }

    if (url.pathname === '/sent') {
      if (request.method === 'GET') {
        const rows = await env.SUPREME_DB.prepare('SELECT key, state FROM sent_states').all();
        const obj = {};
        for (const row of rows.results) obj[row.key] = row.state;
        return json(obj);
      }
      if (request.method === 'POST') {
        if (!checkAuth()) return new Response('Unauthorized', { status: 401, headers: cors });
        let body;
        try { body = JSON.parse(await request.text()); } catch(e) { return new Response('Bad JSON', { status: 400, headers: cors }); }
        if (body.wipeAll === true) {
          await env.SUPREME_DB.prepare('DELETE FROM sent_states').run();
          return json({ status: 'ok', wiped: true });
        }
        const now = Date.now();
        const stmts = Object.keys(body).map(key => env.SUPREME_DB.prepare(
          `INSERT INTO sent_states (key, state, updated_at) VALUES (?1, ?2, ?3)
           ON CONFLICT(key) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at
           WHERE excluded.updated_at >= sent_states.updated_at`
        ).bind(key, body[key], now));
        if (stmts.length) await env.SUPREME_DB.batch(stmts);
        return json({ status: 'ok' });
      }
    }

    if (url.pathname === '/vision' && request.method === 'POST') {
      const apiKey = request.headers.get('x-api-key');
      if (!apiKey) return new Response('Missing API key', { status: 401, headers: cors });
      const body = await request.text();
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: body,
      });
      const text = await resp.text();
      return new Response(text, { status: resp.status, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    return new Response('Not found', { status: 404, headers: cors });
  }
};
