#!/usr/bin/env node
// Local Phase 1 verification — no Cloudflare account required.
// Uses Node's built-in node:sqlite as an in-memory D1 stand-in.

import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SCHEMA_FILE = path.join(ROOT, 'migrations', '0001_init.sql');
const SEED_SCRIPT = path.join(ROOT, 'scripts', 'gen-seed.mjs');
const SEED_FILE = path.join(ROOT, 'migrations', '0002_seed.sql');
const WORKER_FILE = path.join(ROOT, 'src', 'worker', 'index.js');

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function makeD1(db) {
  return {
    prepare(sql) {
      let params = [];
      const stmt = {
        bind(...args) {
          params = args;
          return stmt;
        },
        async all() {
          return { results: db.prepare(sql).all(...params), success: true, meta: {} };
        },
        async first() {
          return db.prepare(sql).get(...params) ?? null;
        },
        async run() {
          const info = db.prepare(sql).run(...params);
          return { results: [], success: true, meta: info };
        },
      };
      return stmt;
    },
  };
}

async function loadWorker() {
  try {
    return await import(pathToFileURL(WORKER_FILE).href);
  } catch (err) {
    // Fallback for Node versions that treat an untyped .js file as CommonJS.
    if (!/export|module|Unexpected token/i.test(String(err && err.message))) throw err;
    const source = await readFile(WORKER_FILE, 'utf8');
    const url = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
    return import(url);
  }
}

async function main() {
  console.log('--- Phase 1 verification ---');

  // 1. Generate the seed migration from src/01-data.js.
  const genOut = execFileSync(process.execPath, [SEED_SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
  console.log(genOut);
  check('gen-seed reports 7/27/12',
    /islands=7\b/.test(genOut) && /items=27\b/.test(genOut) && /flows=12\b/.test(genOut),
    genOut);

  // 2. Build an in-memory DB, apply schema + seed.
  const db = new DatabaseSync(':memory:');
  const schema = await readFile(SCHEMA_FILE, 'utf8');
  const seed = await readFile(SEED_FILE, 'utf8');
  db.exec(schema);
  check('schema applies', true);

  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
  );
  const required = [
    'islands', 'items', 'flows', 'users', 'sessions',
    'mutations', 'news_items', 'world_meta',
  ];
  const missing = required.filter((name) => !tables.has(name));
  check('all required tables exist', missing.length === 0, `missing: ${missing.join(', ')}`);

  db.exec(seed);
  const count = (table) => Number(db.prepare(
    `SELECT COUNT(*) AS n FROM ${table} WHERE deleted_at IS NULL`
  ).get().n);

  check('islands = 7', count('islands') === 7, `got ${count('islands')}`);
  check('items = 27', count('items') === 27, `got ${count('items')}`);
  check('flows = 12', count('flows') === 12, `got ${count('flows')}`);

  // 3. Seed must be safely repeatable.
  db.exec(seed);
  check('seed is repeatable (7/27/12)',
    count('islands') === 7 && count('items') === 27 && count('flows') === 12,
    `${count('islands')}/${count('items')}/${count('flows')}`);

  const seqRow = db.prepare("SELECT v FROM world_meta WHERE k = 'seq'").get();
  check('world_meta.seq exists', !!seqRow && seqRow.v === '0', JSON.stringify(seqRow));

  const orphanItems = Number(db.prepare(
    'SELECT COUNT(*) AS n FROM items i LEFT JOIN islands s ON s.id = i.island_id WHERE s.id IS NULL'
  ).get().n);
  const orphanFlows = Number(db.prepare(
    'SELECT COUNT(*) AS n FROM flows f WHERE NOT EXISTS (SELECT 1 FROM islands s WHERE s.id = f.from_island) ' +
    'OR NOT EXISTS (SELECT 1 FROM islands s WHERE s.id = f.to_island)'
  ).get().n);
  check('seed rows reference valid islands', orphanItems === 0 && orphanFlows === 0,
    `orphan items=${orphanItems}, flows=${orphanFlows}`);

  // 4. Exercise the Worker handler against a mock D1 binding.
  const worker = await loadWorker();
  check('worker exports handleRequest', typeof worker.handleRequest === 'function');

  const d1 = makeD1(db);
  const call = async (pathname, opts = {}) => {
    const req = new Request('https://policy-islands.test' + pathname, {
      method: opts.method || 'GET',
    });
    const res = await worker.handleRequest(req, opts.env ?? { DB: d1 });
    const body = await res.json().catch(() => null);
    return { res, body };
  };

  const health = await call('/api/health');
  check('GET /api/health',
    health.res.status === 200 && health.body?.ok === true &&
    health.body?.world === 'ready' && health.body?.backend === 'd1',
    JSON.stringify(health.body));

  const healthNoDb = await call('/api/health', { env: {} });
  check('health without backend reports missing',
    healthNoDb.res.status === 200 && healthNoDb.body?.world === 'missing' &&
    healthNoDb.body?.backend === 'none',
    JSON.stringify(healthNoDb.body));

  const world = await call('/api/world');
  check('GET /api/world status', world.res.status === 200, String(world.res.status));
  check('GET /api/world counts 7/27/12',
    world.body?.islands?.length === 7 &&
    world.body?.items?.length === 27 &&
    world.body?.flows?.length === 12,
    JSON.stringify({
      islands: world.body?.islands?.length,
      items: world.body?.items?.length,
      flows: world.body?.flows?.length,
    }));
  check('GET /api/world seq is a number', typeof world.body?.seq === 'number',
    String(world.body?.seq));
  check('GET /api/world CORS', world.res.headers.get('Access-Control-Allow-Origin') === '*');
  check('GET /api/world island shape',
    world.body?.islands?.[0]?.id === 'hub' &&
    world.body?.islands?.[0]?.name?.zh &&
    Array.isArray(world.body?.items?.[0]?.facts),
    JSON.stringify(world.body?.islands?.[0]));

  const island = await call('/api/islands/hub');
  check('GET /api/islands/hub', island.res.status === 200 && island.body?.island?.id === 'hub',
    JSON.stringify(island.body?.island));
  check('hub detail items = 3', island.body?.items?.length === 3,
    String(island.body?.items?.length));
  check('hub detail flows present', Array.isArray(island.body?.flows) && island.body.flows.length >= 1,
    String(island.body?.flows?.length));

  const missingIsland = await call('/api/islands/nope');
  check('unknown island → 404 JSON error',
    missingIsland.res.status === 404 && typeof missingIsland.body?.error === 'string',
    JSON.stringify(missingIsland.body));

  const worldNoDb = await call('/api/world', { env: {} });
  check('world without D1 → 503 JSON error',
    worldNoDb.res.status === 503 && typeof worldNoDb.body?.error === 'string',
    JSON.stringify(worldNoDb.body));

  const mutations = await call('/api/mutations?since=0');
  check('GET /api/mutations?since=0', mutations.res.status === 200 &&
    Array.isArray(mutations.body?.mutations), JSON.stringify(mutations.body));
  check('mutations since validates input',
    (await call('/api/mutations?since=abc')).res.status === 400);

  // Phase 2 writes will append here; this proves the incremental endpoint works.
  db.prepare(
    'INSERT INTO mutations (seq, type, payload_json, actor_id, actor_token, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(1, 'add_item', '{"id":"x"}', null, null, Date.now());
  const after = await call('/api/mutations?since=0');
  check('mutations since returns appended row',
    after.body?.mutations?.length === 1 && after.body.mutations[0].seq === 1 &&
    after.body.mutations[0].payload?.id === 'x',
    JSON.stringify(after.body));

  // ── Durable Object path (正式部署路徑) ────────────────────────────────────
  // Worker 用 stub.fetch() 轉發到 DO 內部 HTTP，所以 mock 一個 fetch 介面。
  const doStub = {
    async fetch(request) {
      const u = new URL(request.url);
      const p = u.pathname.replace(/\/+$/, '') || '/';
      const jsonRes = (obj, status = 200) => new Response(JSON.stringify(obj), {
        status, headers: { 'Content-Type': 'application/json' },
      });
      if (p === '/world') {
        return jsonRes({
          islands: db.prepare('SELECT * FROM islands WHERE deleted_at IS NULL ORDER BY no, id').all(),
          items: db.prepare('SELECT * FROM items WHERE deleted_at IS NULL ORDER BY island_id, no, id').all(),
          flows: db.prepare('SELECT * FROM flows WHERE deleted_at IS NULL ORDER BY id').all(),
          seq: Number(db.prepare("SELECT v FROM world_meta WHERE k = 'seq'").get()?.v ?? 0),
        });
      }
      const m = p.match(/^\/islands\/(.+)$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        const island = db.prepare('SELECT * FROM islands WHERE id = ? AND deleted_at IS NULL LIMIT 1').get(id);
        if (!island) return jsonRes({ error: 'island not found' }, 404);
        return jsonRes({
          island,
          items: db.prepare('SELECT * FROM items WHERE island_id = ? AND deleted_at IS NULL ORDER BY no, id').all(id),
          flows: db.prepare('SELECT * FROM flows WHERE (from_island = ? OR to_island = ?) AND deleted_at IS NULL ORDER BY id').all(id, id),
        });
      }
      if (p === '/mutations') {
        const since = Number(u.searchParams.get('since') || 0);
        return jsonRes({
          mutations: db.prepare('SELECT * FROM mutations WHERE seq > ? ORDER BY seq ASC LIMIT 500').all(since),
          seq: Number(db.prepare("SELECT v FROM world_meta WHERE k = 'seq'").get()?.v ?? 0),
        });
      }
      return jsonRes({ error: 'not found' }, 404);
    },
  };
  const doEnv = { WORLD_ROOM: { getByName: () => doStub } };

  const doHealth = await call('/api/health', { env: doEnv });
  check('DO health reports durable-object backend',
    doHealth.body?.backend === 'durable-object' && doHealth.body?.world === 'ready',
    JSON.stringify(doHealth.body));

  const doWorld = await call('/api/world', { env: doEnv });
  check('DO /api/world counts 7/27/12',
    doWorld.res.status === 200 && doWorld.body?.islands?.length === 7 &&
    doWorld.body?.items?.length === 27 && doWorld.body?.flows?.length === 12,
    JSON.stringify({
      islands: doWorld.body?.islands?.length,
      items: doWorld.body?.items?.length,
      flows: doWorld.body?.flows?.length,
    }));

  const doIsland = await call('/api/islands/hub', { env: doEnv });
  check('DO /api/islands/hub works',
    doIsland.res.status === 200 && doIsland.body?.island?.id === 'hub' &&
    doIsland.body?.items?.length === 3,
    JSON.stringify(doIsland.body?.items?.length));

  const doMissing = await call('/api/islands/nope', { env: doEnv });
  check('DO unknown island → 404', doMissing.res.status === 404,
    String(doMissing.res.status));

  const doMutations = await call('/api/mutations?since=0', { env: doEnv });
  check('DO /api/mutations works', doMutations.res.status === 200 &&
    Array.isArray(doMutations.body?.mutations), JSON.stringify(doMutations.body));

  // ── Phase 2/3/4：session + mutation + gate（mock DO fetch 介面）──────────
  const wsSessions = [];
  const doMock2 = {
    async fetch(request, server) {
      const u = new URL(request.url);
      const p = u.pathname.replace(/\/+$/, '') || '/';
      const jsonRes = (obj, status = 200) => new Response(JSON.stringify(obj), {
        status, headers: { 'Content-Type': 'application/json' } });
      if (p === '/session' && request.method === 'POST') { return jsonRes({ ok: true }); }
      if (p === '/verify') {
        // mock：接受任何 valid-format token（測試路由流程，唔測密碼學）
        const hash = u.searchParams.get('hash') || '';
        return jsonRes({ ok: hash.length === 64 });
      }
      if (p === '/mutate' && request.method === 'POST') {
        const body = await request.json();
        if (body.type === 'add_item') {
          const ok = body.payload?.item?.model === 'chaChaan';
          return jsonRes(ok ? { ok: true, seq: 42 } : { ok: false, error: 'model not allowed' }, ok ? 200 : 400);
        }
        if (body.type === 'add_island') {
          return jsonRes({ ok: true, seq: 43 });
        }
        return jsonRes({ ok: false, error: 'unknown type' }, 400);
      }
      if (p === '/news/gate') {
        const theme = u.searchParams.get('theme') || '';
        return jsonRes({ ok: theme === 'transport' ? false : true, count: theme === 'transport' ? 3 : 0, total: 7 });
      }
      if (p === '/news/check') { return jsonRes({ exists: false }); }
      return jsonRes({ error: 'not found' }, 404);
    }
  };
  const env23 = { WORLD_ROOM: { getByName: () => doMock2 } };

  // session（mock 返 token）
  const sessionRes = await worker.handleRequest(new Request('https://policy-islands.test/api/session', { method: 'POST' }), env23);
  const sessionBody = await sessionRes.json().catch(() => null);
  check('POST /api/session returns token', sessionRes.status === 200 && typeof sessionBody?.token === 'string' && /^pi_[0-9a-f]{64}$/.test(sessionBody.token));

  // mutation 冇 token → 401
  const noTok = await worker.handleRequest(new Request('https://policy-islands.test/api/mutations', { method: 'POST', body: JSON.stringify({ type: 'add_item', payload: {} }) }), env23);
  check('mutation without token → 401', noTok.status === 401);

  // mutation 有 token（mock verify 接受 a1b2...）→ DO 拒絕唔喺白名單嘅 model
  const badModel = await worker.handleRequest(new Request('https://policy-islands.test/api/mutations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer pi_' + 'a1b2'.padEnd(64, '0') },
    body: JSON.stringify({ type: 'add_item', payload: { item: { id: 'u1', islandId: 'hub', model: 'skyscraper2', name: { zh: 'x' } } } })
  }), env23);
  check('mutation rejected model → 400', badModel.status === 400);

  // 合法 mutation → 200 + seq
  const okMut = await worker.handleRequest(new Request('https://policy-islands.test/api/mutations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer pi_' + 'a1b2'.padEnd(64, '0') },
    body: JSON.stringify({ type: 'add_item', payload: { item: { id: 'u2', islandId: 'hub', model: 'chaChaan', name: { zh: '茶記' } } } })
  }), env23);
  const okMutBody = await okMut.json().catch(() => null);
  check('valid mutation → 200 + seq', okMut.status === 200 && okMutBody?.seq === 42);

  // WS upgrade 需要 Upgrade header
  const wsNoUpgrade = await worker.handleRequest(new Request('https://policy-islands.test/ws'), env23);
  check('GET /ws without Upgrade → 426', wsNoUpgrade.status === 426);

  // 新聞 gate（mock：transport 已滿 → 拒）
  const gate = await doMock2.fetch(new Request('https://worldroom.internal/news/gate?day=20261023&theme=transport'));
  const gateBody = await gate.json();
  check('news gate blocks over-limit theme', gateBody.ok === false);
  const gate2 = await doMock2.fetch(new Request('https://worldroom.internal/news/gate?day=20261023&theme=health'));
  const gate2Body = await gate2.json();
  check('news gate allows free theme', gate2Body.ok === true);

  // 前端 09-net.js 存在（build ORDER 加咗）
  const netSrc = await readFile(path.join(ROOT, 'src', '09-net.js'), 'utf8');
  check('09-net.js exists with polling + submit + UI', /startPolling/.test(netSrc) && /submitMutation/.test(netSrc) && /injectAddUI/.test(netSrc) && /openLeaderboard/.test(netSrc));

  // 04-buildings.js 有動態新增 expose
  const bSrc = await readFile(path.join(ROOT, 'src', '04-buildings.js'), 'utf8');
  check('04-buildings exposes __addItemMesh/__addIsland',
    /__addItemMesh/.test(bSrc) && /__addIsland/.test(bSrc) && /standaloneBuilder/.test(bSrc));

  // 14 個香港 archetypes 存在
  const hkArches = ['tram', 'starferry', 'tonglau', 'estate', 'chaChaan', 'market', 'temple', 'pawnshop', 'skyscraper', 'cinema', 'jockey', 'kcr', 'mahjong', 'lighthouse']
    .filter(k => new RegExp('ARCH\\.' + k + '\\s*=').test(bSrc));
  check('14 HK archetypes present', hkArches.length === 14, 'found ' + hkArches.length);

  // 6 個新 HK items 喺 01-data.js
  const dSrc = await readFile(path.join(ROOT, 'src', '01-data.js'), 'utf8');
  const hkItems = ['t4', 't5', 'e4', 'o4', 'o5', 'c4'].filter(k => new RegExp("'" + k + "':").test(dSrc));
  check('6 HK items added', hkItems.length === 6, 'found ' + hkItems.length);

  // WorldRoom class must exist and expose the RPC methods the Worker calls.
  const roomFile = path.join(ROOT, 'src', 'worker', 'world-room.js');
  const roomSrc = await readFile(roomFile, 'utf8');
  check('WorldRoom class exported',
    /export class WorldRoom/.test(roomSrc));
  check('WorldRoom exposes getWorld/getIsland/getMutations',
    /async getWorld\(/.test(roomSrc) && /async getIsland\(/.test(roomSrc) &&
    /async getMutations\(/.test(roomSrc));
  check('WorldRoom has internal fetch() entry (RPC not used)',
    /async fetch\(request/.test(roomSrc));
  check('WorldRoom uses ctx.storage.sql',
    /ctx\.storage\.sql/.test(roomSrc) || /this\.sql\s*=\s*ctx\.storage\.sql/.test(roomSrc));

  // dist/seed.sql must exist for the DO bootstrap path.
  const seedDist = path.join(ROOT, 'dist', 'seed.sql');
  let seedDistOk = false;
  try {
    const sd = await readFile(seedDist, 'utf8');
    seedDistOk = sd.includes('INSERT OR REPLACE INTO islands') && sd.length > 1000;
  } catch { /* not built yet */ }
  check('dist/seed.sql exists for DO bootstrap', seedDistOk);

  const optReq = new Request('https://policy-islands.test/api/world', { method: 'OPTIONS' });
  const optRes = await worker.handleRequest(optReq, { DB: d1 });
  check('OPTIONS preflight → 204 + CORS',
    optRes.status === 204 && optRes.headers.get('Access-Control-Allow-Origin') === '*');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('FAIL phase 1 verification');
    process.exitCode = 1;
  } else {
    console.log('PASS phase 1 verification');
  }
}

main().catch((err) => {
  console.error(`FAIL phase 1 verification — ${err && err.stack ? err.stack : err}`);
  process.exitCode = 1;
});
