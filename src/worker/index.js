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
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
    actorToken: null,
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

// ── Phase 3：匿名 session ────────────────────────────────────────────────
async function sha256Hex(text) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function randomToken() {
  const arr = new Uint8Array(32);
  globalThis.crypto.getRandomValues(arr);
  return 'pi_' + [...arr].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// 同一 IP 30 秒內重用同一 token：避免不停 POST /api/session 換新 token
// 而繞過 DO 嘅 per-token mutation 限流（Map 只存活於單一 isolate，成本最低）。
const SESSION_WINDOW_MS = 30000;
const sessionIssued = new Map();
async function createSession(env, clientIp) {
  if (!hasDO(env)) return { ok: false, status: 503, error: 'no world backend' };
  const now = Date.now();
  const ip = clientIp || 'unknown';
  const cached = sessionIssued.get(ip);
  if (cached && now - cached.at < SESSION_WINDOW_MS) return { ok: true, token: cached.token };
  const token = randomToken();
  const hash = await sha256Hex(token);
  const stub = await doStub(env);
  const r = await stub.fetch(new Request(DO_ORIGIN + '/session', {
    method: 'POST',
    body: JSON.stringify({ tokenHash: hash, now })
  }));
  if (!r.ok) return { ok: false, status: 500, error: 'session create failed' };
  sessionIssued.set(ip, { token, at: now });
  if (sessionIssued.size > 5000) {
    for (const [k, v] of sessionIssued) {
      if (now - v.at > SESSION_WINDOW_MS) sessionIssued.delete(k);
    }
  }
  return { ok: true, token };
}
async function verifyToken(env, token) {
  if (!token || typeof token !== 'string' || !/^pi_[0-9a-f]{64}$/.test(token)) return false;
  if (!hasDO(env)) return false;
  const hash = await sha256Hex(token);
  const stub = await doStub(env);
  const r = await stub.fetch(new Request(DO_ORIGIN + '/verify?hash=' + hash));
  if (!r.ok) return false;
  const d = await r.json();
  return !!(d && d.ok);
}

// ── Phase 2：WebSocket upgrade → DO ───────────────────────────────────────
async function handleWebSocket(request, env) {
  const upgrade = request.headers.get('Upgrade');
  if (upgrade !== 'websocket') return fail('Expected Upgrade: websocket', 426);
  if (!hasDO(env)) return fail('no world backend', 503);
  const stub = await doStub(env);
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  // 保留原始 headers（Upgrade/Connection），用 RequestInit 形式傳畀 DO
  await stub.fetch(new Request(DO_ORIGIN + '/ws', { headers: request.headers }), server);
  return new Response(null, { status: 101, webSocket: client });
}

// ── Phase 4：新聞 pipeline（cron）────────────────────────────────────────
const NEWS_FEEDS = [
  'https://www.info.gov.hk/gia/rss/general_zh.xml',
  'https://rthk9.rthk.hk/rthk/news/rss/c_expressnews_clocal.xml'
];
const NEWS_KW = {
  transport: ['巴士', '車費', '公共交通', '鐵路', '交通', '隧道', '單車', '的士', '渡輪', '機場', '港鐵', '小巴', '通勤', '口岸', '道路'],
  education: ['學校', '教育', '學生', '老師', '教師', '課程', '考試', '大學', '學院', '圖書館', '閱讀', '培訓', '人才', '技能', '幼稚園', '中小學', '書'],
  health: ['醫院', '診所', '健康', '醫生', '護士', '病人', '疾病', '疫苗', '流感', '病毒', '長者', '安老', '醫療', '藥物', '手術', '衞生', '精神', '復康'],
  housing: ['房屋', '屋邨', '公屋', '居屋', '劏房', '租金', '租務', '業主', '租戶', '安置', '居所', '重建', '住宅', '樓價', '上樓', '青年宿舍'],
  environment: ['環境', '綠化', '廢物', '垃圾', '回收', '污染', '碳', '排放', '河道', '海水', '噪音', '空氣', '氣候', '節能', '減廢', '樹木', '公園', '保育', '郊野'],
  economy: ['經濟', '稅', '關稅', '財政', '預算', '貿易', '工商', '企業', '就業', '職位', '市場', '零售', '消費', 'GDP', '物價', '通脹', '旅遊', '投資', '金融', '銀行', '人民幣', '上市']
};
function classifyNews(text) {
  let best = null, bestN = 0;
  for (const t in NEWS_KW) {
    const n = NEWS_KW[t].reduce((a, k) => a + (text.includes(k) ? 1 : 0), 0);
    if (n > bestN) { bestN = n; best = t; }
  }
  return bestN >= 2 ? best : null;   // 至少要兩個關鍵詞先算命中（減假陽性）
}
function parseRss(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const title = (block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/) || [])[1] || '';
    const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '';
    const descRaw = (block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) || [])[1] || '';
    const desc = descRaw.replace(/<[^>]+>/g, '').slice(0, 400);
    const date = (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '';
    if (title && link) items.push({ title: title.trim(), link: link.trim(), desc, date });
  }
  return items;
}
async function newsId(url) {
  // 同 world-room.js 嘅 newsId() 一致：sha256(url) 前 16 hex
  return (await sha256Hex(url)).slice(0, 16);
}
async function runNewsPipeline(env) {
  if (!hasDO(env)) return { ok: false, error: 'no backend' };
  const stub = await doStub(env);
  const now = new Date();
  const dayKey = now.toISOString().slice(0, 10).replace(/-/g, '');
  const out = { fetched: 0, new: 0, created: 0, skipped: 0, errors: [] };

  for (const feedUrl of NEWS_FEEDS) {
    let xml;
    try {
      const res = await fetch(feedUrl, { headers: { 'User-Agent': 'policy-islands/1.0' } });
      if (!res.ok) { out.errors.push(feedUrl + ' HTTP ' + res.status); continue; }
      xml = await res.text();
    } catch (e) { out.errors.push(feedUrl + ' ' + (e && e.message)); continue; }
    const items = parseRss(xml);
    out.fetched += items.length;
    for (const it of items) {
      const id = await newsId(it.link);
      const text = it.title + ' ' + it.desc;
      const theme = classifyNews(text);
      if (!theme) { out.skipped++; continue; }
      // 去重：問 DO 呢條新聞見未
      const dupRes = await stub.fetch(new Request(DO_ORIGIN + '/news/check?id=' + id));
      const dup = await dupRes.json();
      if (dup.exists) { out.skipped++; continue; }
      out.new++;
      // gating：今日新聞島數量 + 總島數量（由 DO 提供）
      const gateRes = await stub.fetch(new Request(DO_ORIGIN + '/news/gate?day=' + dayKey + '&theme=' + theme));
      const gate = await gateRes.json();
      if (!gate.ok) { out.skipped++; continue; }
      // 建島：news-YYYYMMDD-NN
      const nn = String(gate.count + 1).padStart(2, '0');
      const islandId = 'news-' + dayKey + '-' + nn;
      // 島名截短（CSS2D pill 可讀性）：優先喺標點/空格截，最多 24 字
      let title = it.title.trim();
      if (title.length > 24) {
        const cut = title.slice(0, 24);
        const m = cut.match(/^(.+?)[（(：:、，。,. ]/);
        title = (m ? m[1] : cut) + '…';
      }
      const island = {
        id: islandId, no: String(97 + Number(gate.newsTotal || 0)), theme,
        name: { zh: title, en: title },
        summary: { zh: it.desc.slice(0, 120), en: it.desc.slice(0, 120) },
        icon: '📰', color: 0x9cc27a, ang: null, radius: 32,
        newsId: id,
        itemModel: theme === 'transport' ? 'kcr' : theme === 'health' ? 'clinic' : theme === 'education' ? 'temple' : theme === 'housing' ? 'estate' : theme === 'environment' ? 'lighthouse' : 'jockey'
      };
      const mutRes = await stub.fetch(new Request(DO_ORIGIN + '/mutate', {
        method: 'POST',
        body: JSON.stringify({ type: 'add_island', payload: { island }, actorToken: 'news-pipeline' })
      }));
      const mut = await mutRes.json();
      if (mut.ok) {
        out.created++;
        // 新聞去重記錄：成功建島後寫入（同一 url 之後會由 /news/check 攔住）
        const recRes = await stub.fetch(new Request(DO_ORIGIN + '/news/record', {
          method: 'POST',
          body: JSON.stringify({
            feed: feedUrl, url: it.link, titleZh: title, titleEn: title,
            summary: it.desc, publishedAt: Date.parse(it.date) || now.getTime(),
            theme, score: 1, islandId, rawJson: JSON.stringify(it)
          })
        }));
        if (!recRes.ok) out.errors.push('news record failed: ' + it.link);
      } else { out.errors.push('create island failed: ' + mut.error); }
    }
  }
  return out;
}

// ── router ─────────────────────────────────────────────────────────────────
export async function handleRequest(request, env = {}) {
  const method = (request.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  // 注意：POST 路由（/api/session、/api/mutations）由 router 處理；
  // 其他非 GET path 喺 router 尾先回 405。

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return fail('invalid request URL', 400);
  }

  const path = url.pathname.replace(/\/+$/, '') || '/';

  try {
    // Phase 2：WebSocket
    if (path === '/ws') {
      return await handleWebSocket(request, env);
    }
    // Phase 3：匿名 session + mutations
    if (path === '/api/session' && method === 'POST') {
      const r = await createSession(env, request.headers.get('cf-connecting-ip') || 'unknown');
      if (!r.ok) return fail(r.error, r.status);
      return json({ token: r.token });
    }
    if (path === '/api/proposals') {
      const r = await doCall(env, '/proposals');
      if (!r.ok) return fail(r.error, r.status);
      return json(r.data);
    }
    if (path === '/api/island-votes') {
      const r = await doCall(env, '/island-votes');
      if (!r.ok) return fail(r.error, r.status);
      return json(r.data);
    }
    if (path === '/api/tasks') {
      const auth = request.headers.get('Authorization') || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!token) return fail('session token required', 401);
      const stub = await doStub(env);
      const r = await stub.fetch(new Request(DO_ORIGIN + '/tasks', {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token },
      }));
      const d = await r.json().catch(() => null);
      if (!r.ok) return fail((d && d.error) || 'tasks failed', r.status);
      return json(d);
    }
    if (path === '/api/leaderboard') {
      const r = await doCall(env, '/leaderboard');
      if (!r.ok) return fail(r.error, r.status);
      return json(r.data);
    }
    if (path === '/api/mutations' && method === 'POST') {
      const auth = request.headers.get('Authorization') || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const okTok = await verifyToken(env, token);
      if (!okTok) return fail('invalid or missing session token', 401);
      let body;
      try { body = await request.json(); } catch { return fail('invalid JSON', 400); }
      if (!body.type || !body.payload) return fail('type and payload required', 400);
      const stub = await doStub(env);
      // actorToken 用 full hash（SHA-256 唔會逆推，安全）；DO 用佢加分
      const fullHash = await sha256Hex(token);
      const r = await stub.fetch(new Request(DO_ORIGIN + '/mutate', {
        method: 'POST',
        body: JSON.stringify({ type: body.type, payload: body.payload, actorToken: fullHash })
      }));
      const d = await r.json().catch(() => null);
      if (!r.ok) return fail((d && d.error) || 'mutation rejected', r.status);
      return json({ ok: true, seq: d.seq });
    }
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

    if (method !== 'GET') return fail('method not allowed', 405);
    return fail('not found', 404);
  } catch (err) {
    console.error('API error:', err && err.message ? err.message : err);
    return fail('internal server error', 500);
  }
}

// 其他 route 未命中：非 GET → 405，否則 404
export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
  // Phase 4：新聞 cron（每 2 小時）
  async scheduled(event, env, ctx) {
    const out = await runNewsPipeline(env);
    console.log('news pipeline:', JSON.stringify(out));
  },
};

export { WorldRoom };
