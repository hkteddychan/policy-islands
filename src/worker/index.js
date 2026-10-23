// Policy Islands · Phase 1 read-only API for Cloudflare Workers.
//
// 兩種後端，同一個介面：
//   • Durable Object `WorldRoom`（正式路徑 — 本帳戶 token 有 DO scope，冇 D1 scope）
//   • D1 binding `DB`（本地測試用 mock；正式部署唔會用到）
//
// 前端零改動：`src/01-data.js` 仍然硬編碼 seed 做 fallback，API 只係多一個可選來源。

import { WorldRoom } from './world-room.js';

const VERSION = '1.1.0-phase1.5';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
    },
  });
}

function fail(message, status = 500) {
  return json({ error: message }, status);
}

function parseJSON(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// ── row → API shape ─────────────────────────────────────────────────────────
function islandRow(row) {
  return {
    id: row.id,
    no: row.no,
    theme: row.theme,
    name: { zh: row.name_zh, en: row.name_en },
    summary: { zh: row.summary_zh || '', en: row.summary_en || '' },
    icon: row.icon,
    color: row.color,
    ang: row.ang,
    radius: row.radius,
    origin: row.origin,
    newsId: row.news_id,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function itemRow(row) {
  return {
    id: row.id,
    islandId: row.island_id,
    no: row.no,
    model: row.model,
    name: { zh: row.name_zh, en: row.name_en },
    facts: parseJSON(row.facts_json, []),
    timeline: parseJSON(row.timeline_json, []),
    src: row.src,
    freq: row.freq,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function flowRow(row) {
  return {
    id: row.id,
    from: row.from_island,
    to: row.to_island,
    kind: row.kind,
    ev: row.ev,
    updated: row.updated,
    depts: row.depts,
    carry: { zh: row.carry_zh || '', en: row.carry_en || '' },
    icon: row.icon,
    note: { zh: row.note_zh || '', en: row.note_en || '' },
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function mutationRow(row) {
  return {
    id: row.id,
    seq: row.seq,
    type: row.type,
    payload: parseJSON(row.payload_json, {}),
    actorId: row.actor_id,
    actorToken: row.actor_token,
    createdAt: row.created_at,
  };
}

// ── backend abstraction ────────────────────────────────────────────────────
// 回傳 { ok:true, world } / { ok:false, status, error }

function hasDO(env) {
  return !!(env && env.WORLD_ROOM && typeof env.WORLD_ROOM.getByName === 'function');
}

function hasDB(env) {
  return !!(env && env.DB && typeof env.DB.prepare === 'function');
}

async function doStub(env) {
  return env.WORLD_ROOM.getByName('main');
}

// 用 DO 內部 HTTP（stub.fetch）而唔係 RPC：DO class 用傳統 constructor 寫法，
// 冇 extends DurableObject → 唔支援 RPC（Cloudflare 會丟 "does not support RPC"）。
const DO_ORIGIN = 'https://worldroom.internal';
async function doCall(env, path) {
  const stub = await doStub(env);
  const res = await stub.fetch(new Request(DO_ORIGIN + path));
  const body = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, status: res.status, error: (body && body.error) || 'world room error' };
  return { ok: true, data: body };
}

async function backendState(env) {
  if (hasDO(env)) {
    try {
      const r = await doCall(env, '/world');
      return r.ok ? 'ready' : 'error';
    } catch (err) {
      console.error('DO probe failed:', err && err.message ? err.message : err);
      return 'error';
    }
  }
  if (hasDB(env)) return 'ready';
  return 'missing';
}

async function fetchWorld(env) {
  if (hasDO(env)) {
    const r = await doCall(env, '/world');
    if (!r.ok) return { ok: false, status: r.status, error: r.error };
    const w = r.data || {};
    return {
      islands: (w.islands || []).map(islandRow),
      items: (w.items || []).map(itemRow),
      flows: (w.flows || []).map(flowRow),
      seq: w.seq ?? 0,
    };
  }
  if (!hasDB(env)) return { ok: false, status: 503, error: 'no world backend configured (need WORLD_ROOM or DB binding)' };
  const [islands, items, flows, meta] = await Promise.all([
    env.DB.prepare('SELECT * FROM islands WHERE deleted_at IS NULL ORDER BY no, id').all(),
    env.DB.prepare('SELECT * FROM items WHERE deleted_at IS NULL ORDER BY island_id, no, id').all(),
    env.DB.prepare('SELECT * FROM flows WHERE deleted_at IS NULL ORDER BY id').all(),
    env.DB.prepare("SELECT v FROM world_meta WHERE k = 'seq'").all(),
  ]);
  const seq = Number((meta.results || [])[0]?.v ?? 0);
  return {
    islands: (islands.results || []).map(islandRow),
    items: (items.results || []).map(itemRow),
    flows: (flows.results || []).map(flowRow),
    seq: Number.isFinite(seq) ? seq : 0,
  };
}

async function fetchIsland(env, id) {
  if (hasDO(env)) {
    const r = await doCall(env, '/islands/' + encodeURIComponent(id));
    if (!r.ok) return { ok: false, status: r.status, error: r.error };
    const d = r.data || {};
    if (!d.island) return { ok: false, status: 404, error: 'island not found' };
    return {
      island: islandRow(d.island),
      items: (d.items || []).map(itemRow),
      flows: (d.flows || []).map(flowRow),
    };
  }
  if (!hasDB(env)) return { ok: false, status: 503, error: 'no world backend configured (need WORLD_ROOM or DB binding)' };
  const island = await env.DB.prepare('SELECT * FROM islands WHERE id = ? AND deleted_at IS NULL LIMIT 1').bind(id).all();
  if (!island.results || !island.results.length) return { ok: false, status: 404, error: 'island not found' };
  const [items, flows] = await Promise.all([
    env.DB.prepare('SELECT * FROM items WHERE island_id = ? AND deleted_at IS NULL ORDER BY no, id').bind(id).all(),
    env.DB.prepare('SELECT * FROM flows WHERE (from_island = ? OR to_island = ?) AND deleted_at IS NULL ORDER BY id').bind(id, id).all(),
  ]);
  return {
    island: islandRow(island.results[0]),
    items: (items.results || []).map(itemRow),
    flows: (flows.results || []).map(flowRow),
  };
}

async function fetchMutations(env, since) {
  if (hasDO(env)) {
    const r = await doCall(env, '/mutations?since=' + since);
    if (!r.ok) return { ok: false, status: r.status, error: r.error };
    const d = r.data || {};
    return { mutations: (d.mutations || []).map(mutationRow), seq: d.seq ?? 0 };
  }
  if (!hasDB(env)) return { ok: false, status: 503, error: 'no world backend configured (need WORLD_ROOM or DB binding)' };
  const rows = await env.DB.prepare('SELECT * FROM mutations WHERE seq > ? ORDER BY seq ASC LIMIT 500').bind(since).all();
  const meta = await env.DB.prepare("SELECT v FROM world_meta WHERE k = 'seq'").all();
  const seq = Number((meta.results || [])[0]?.v ?? 0);
  return { mutations: (rows.results || []).map(mutationRow), seq: Number.isFinite(seq) ? seq : 0 };
}

// ── router ─────────────────────────────────────────────────────────────────
export async function handleRequest(request, env = {}) {
  const method = (request.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (method !== 'GET') {
    return fail('method not allowed', 405);
  }

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return fail('invalid request URL', 400);
  }

  const path = url.pathname.replace(/\/+$/, '') || '/';

  try {
    if (path === '/api/health') {
      return json({
        ok: true,
        version: VERSION,
        backend: hasDO(env) ? 'durable-object' : hasDB(env) ? 'd1' : 'none',
        world: await backendState(env),
      });
    }
    if (path === '/api/world') {
      const r = await fetchWorld(env);
      if (r.ok === false) return fail(r.error, r.status);
      return json(r);
    }
    if (path === '/api/mutations') {
      const raw = url.searchParams.get('since');
      let since = 0;
      if (raw !== null && raw !== '') {
        if (!/^\d+$/.test(raw)) return fail('since must be a non-negative integer', 400);
        since = Number(raw);
        if (!Number.isSafeInteger(since)) return fail('since is too large', 400);
      }
      const r = await fetchMutations(env, since);
      if (r.ok === false) return fail(r.error, r.status);
      return json(r);
    }

    const islandMatch = path.match(/^\/api\/islands\/([^/]+)$/);
    if (islandMatch) {
      let id;
      try {
        id = decodeURIComponent(islandMatch[1]);
      } catch {
        return fail('invalid island id', 400);
      }
      const r = await fetchIsland(env, id);
      if (r.ok === false) return fail(r.error, r.status);
      return json(r);
    }

    return fail('not found', 404);
  } catch (err) {
    console.error('API error:', err && err.message ? err.message : err);
    return fail('internal server error', 500);
  }
}

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
};

export { WorldRoom };
