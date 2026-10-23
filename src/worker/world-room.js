// Policy Islands · WorldRoom Durable Object
// 持久 SQL 用 Durable Object 嘅 ctx.storage.sql（Cloudflare Workers 上唯一可用嘅
// 關聯式 SQL API — node:sqlite 喺 Workers 只係 non-functional stub，workerd #6878）。
//
// 為咩唔用 D1：本專案嘅 Cloudflare API token 冇 D1 scope（實測 401 Authentication
// error：GET /accounts/{acc}/d1/database），但有 Durable Objects scope。
// 資料模型完全唔變 — 同一份 migrations/0001_init.sql。
//
// 參考：https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
//   sql.exec(sql, ...params) → cursor；cursor.toArray() → row objects；cursor.one() → row|null

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS islands (
  id           TEXT PRIMARY KEY,
  no           TEXT NOT NULL,
  theme        TEXT NOT NULL,
  name_zh      TEXT NOT NULL,
  name_en      TEXT NOT NULL,
  summary_zh   TEXT,
  summary_en   TEXT,
  icon         TEXT,
  color        INTEGER,
  ang          REAL,
  radius       REAL NOT NULL DEFAULT 22,
  origin       TEXT NOT NULL DEFAULT 'seed',
  news_id      TEXT,
  created_at   INTEGER NOT NULL,
  created_by   TEXT,
  deleted_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_islands_theme ON islands(theme);
CREATE INDEX IF NOT EXISTS idx_islands_live  ON islands(deleted_at, created_at);

CREATE TABLE IF NOT EXISTS items (
  id            TEXT PRIMARY KEY,
  island_id     TEXT NOT NULL REFERENCES islands(id),
  no            INTEGER NOT NULL,
  model         TEXT NOT NULL,
  name_zh       TEXT NOT NULL,
  name_en       TEXT NOT NULL,
  facts_json    TEXT,
  timeline_json TEXT,
  src           TEXT,
  freq          TEXT,
  created_at    INTEGER NOT NULL,
  created_by    TEXT,
  deleted_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_items_island ON items(island_id, deleted_at);

CREATE TABLE IF NOT EXISTS flows (
  id          TEXT PRIMARY KEY,
  from_island TEXT NOT NULL REFERENCES islands(id),
  to_island   TEXT NOT NULL REFERENCES islands(id),
  kind        TEXT NOT NULL,
  ev          TEXT NOT NULL,
  updated     TEXT,
  depts       INTEGER,
  carry_zh    TEXT,
  carry_en    TEXT,
  icon        TEXT,
  note_zh     TEXT,
  note_en     TEXT,
  created_at  INTEGER NOT NULL,
  created_by  TEXT,
  deleted_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_flows_from ON flows(from_island);
CREATE INDEX IF NOT EXISTS idx_flows_to   ON flows(to_island);

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  handle     TEXT UNIQUE,
  kind       TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_users_token ON users(token_hash);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mutations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  seq          INTEGER NOT NULL,
  type         TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  actor_id     TEXT,
  actor_token  TEXT,
  created_at   INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mutations_seq ON mutations(seq);

CREATE TABLE IF NOT EXISTS news_items (
  id           TEXT PRIMARY KEY,
  feed         TEXT NOT NULL,
  url          TEXT NOT NULL,
  title_zh     TEXT,
  title_en     TEXT,
  summary      TEXT,
  published_at INTEGER,
  fetched_at   INTEGER NOT NULL,
  theme        TEXT,
  score        REAL,
  island_id    TEXT,
  raw_json     TEXT
);
CREATE INDEX IF NOT EXISTS idx_news_fetched ON news_items(fetched_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_news_url ON news_items(url);

CREATE TABLE IF NOT EXISTS world_meta (
  k TEXT PRIMARY KEY,
  v TEXT
);
`;

// Seed 資料由 scripts/gen-seed.mjs 產生 → build.py 複製成 dist/seed.sql
// Worker 透過 static assets binding 讀取並 exec（避免 runtime 再寫一份重複資料）。

// Phase 3：允許用戶新增嘅建築模型白名單
const MODEL_WHITELIST = [
  'cottage', 'clinic', 'classroom', 'busstop', 'bike', 'stall', 'pavilion',
  'tram', 'starferry', 'tonglau', 'estate', 'temple', 'chaChaan', 'market',
  'pawnshop', 'skyscraper', 'cinema', 'jockey', 'kcr', 'mahjong', 'lighthouse'
];
const DEFAULT_FACTS = [
  { v: '1', u: { zh: '項', en: '' }, k: { zh: '市民新提案', en: 'citizen proposal' } },
  { v: 'NEW', u: { zh: '', en: '' }, k: { zh: '狀態', en: 'status' } },
  { v: '24', u: { zh: '小時', en: 'h' }, k: { zh: '審議時限', en: 'review window' } }
];
const DEFAULT_TIMELINE = [
  { d: 'now', t: { zh: '市民提交建議，進入審議流程', en: 'Citizen proposal submitted for review' } }
];

export class WorldRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.ready = false;
    this.rateLimits = new Map();
  }

  // Durable Object 內部 HTTP 入口。Worker 用 stub.fetch() 轉發（RPC 需要
  // `extends DurableObject`，呢個 class 用傳統 constructor 寫法，所以行 fetch）。
  async fetch(request, server) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    // WebSocket 升級（Phase 2 即時同步）— server = Worker 傳嚟嘅 server-side socket
    if (path === '/ws') {
      if (!server) return Response.json({ error: 'missing websocket' }, { status: 400 });
      this.ctx.acceptWebSocket(server);
      console.log('WS accepted, sockets now', this.ctx.getWebSockets().length);
      return new Response(null, { status: 101, webSocket: null });
    }
    try {
      if (path === '/world') return Response.json(await this.getWorld());
      if (path === '/mutations') {
        const raw = url.searchParams.get('since');
        let since = 0;
        if (raw !== null && raw !== '') {
          if (!/^\d+$/.test(raw)) return Response.json({ error: 'since must be a non-negative integer' }, { status: 400 });
          since = Number(raw);
          if (!Number.isSafeInteger(since)) return Response.json({ error: 'since is too large' }, { status: 400 });
        }
        return Response.json(await this.getMutations(since));
      }
      // Phase 3：mutation 入口（POST）
      if (path === '/mutate' && request.method === 'POST') {
        let body;
        try { body = await request.json(); } catch { return Response.json({ error: 'invalid JSON' }, { status: 400 }); }
        const r = await this.postMutation(body.type, body.payload, body.actorToken);
        return Response.json(r.ok ? { ok: true, seq: r.seq } : { ok: false, error: r.error }, { status: r.ok ? 200 : r.status });
      }
      // Phase 3：session（token_hash 存 users 表）
      if (path === '/session' && request.method === 'POST') {
        const body = await request.json().catch(() => null);
        if (!body || !body.tokenHash || typeof body.tokenHash !== 'string') {
          return Response.json({ error: 'tokenHash required' }, { status: 400 });
        }
        await this.ensureInit();
        this.sql.exec(
          'INSERT OR REPLACE INTO users (id, handle, kind, token_hash, created_at, last_seen) VALUES (?,?,?,?,?,?)',
          'u_' + body.tokenHash.slice(0, 10), null, 'anonymous', body.tokenHash, body.now || Date.now(), body.now || Date.now());
        return Response.json({ ok: true });
      }
      if (path === '/verify' && request.method === 'GET') {
        const hash = url.searchParams.get('hash') || '';
        await this.ensureInit();
        const u = this.sql.exec('SELECT id FROM users WHERE token_hash = ?', hash).toArray()[0];
        return Response.json({ ok: !!u });
      }
      // 遊戲改進 A：排行榜
      if (path === '/leaderboard' && request.method === 'GET') {
        await this.ensureInit();
        const rows = this.sql.exec(
          "SELECT handle, score, last_seen FROM users WHERE score > 0 ORDER BY score DESC LIMIT 10").toArray();
        return Response.json({ leaderboard: rows.map(r => ({ handle: r.handle || '匿名市民', score: r.score, lastSeen: r.last_seen })) });
      }
      // Phase 4：新聞去重 + gating
      if (path === '/news/check' && request.method === 'GET') {
        const id = url.searchParams.get('id') || '';
        await this.ensureInit();
        const n = this.sql.exec('SELECT id FROM news_items WHERE id = ?', id).toArray()[0];
        return Response.json({ exists: !!n });
      }
      if (path === '/news/gate' && request.method === 'GET') {
        const day = url.searchParams.get('day') || '';
        const theme = url.searchParams.get('theme') || '';
        await this.ensureInit();
        const today = this.sql.exec(
          "SELECT COUNT(*) AS n FROM islands WHERE origin = 'news' AND created_at >= ?",
          Number(new Date().setHours(0, 0, 0, 0))).toArray()[0];
        const todayCount = Number(today?.n || 0);
        const total = this.sql.exec(
          "SELECT COUNT(*) AS n FROM islands WHERE deleted_at IS NULL").toArray()[0];
        const totalCount = Number(total?.n || 0);
        const sameTheme = this.sql.exec(
          "SELECT COUNT(*) AS n FROM islands WHERE origin = 'news' AND theme = ? AND created_at >= ?",
          theme, Number(new Date().setHours(0, 0, 0, 0))).toArray()[0];
        const ok = todayCount < 3 && totalCount < 40 && Number(sameTheme?.n || 0) < 1;
        return Response.json({ ok, count: todayCount, total: totalCount });
      }
      const m = path.match(/^\/islands\/(.+)$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        const r = await this.getIsland(id);
        if (!r) return Response.json({ error: 'island not found' }, { status: 404 });
        return Response.json(r);
      }
      return Response.json({ error: 'not found' }, { status: 404 });
    } catch (err) {
      console.error('WorldRoom error:', err && err.message ? err.message : err);
      return Response.json({ error: 'internal server error' }, { status: 500 });
    }
  }

  // ── Phase 2：WebSocket 訊息 ─────────────────────────────────────────────
  async webSocketMessage(ws, message) {
    console.log('WS message received:', String(message).slice(0, 120));
    let msg;
    try { msg = JSON.parse(message); } catch { return; }
    if (msg.type === 'ping') { try { ws.send(JSON.stringify({ type: 'pong' })); } catch {} return; }
    if (msg.type === 'hello') { try { ws.send(JSON.stringify({ type: 'hello', seq: (await this.getWorld()).seq })); } catch {} return; }
    // 唔接受 client 直接 mutation（一律經 POST /api/mutations 驗證後入嚟）
  }

  async webSocketClose(ws, code, reason, wasClean) {
    // Hibernation 自動處理；冇嘢要清。
  }

  // ── 廣播（hibernation 下用 ctx.getWebSockets()）────────────────────────
  broadcast(message) {
    const data = JSON.stringify(message);
    try {
      const sockets = this.ctx.getWebSockets();
      console.log('broadcast to', sockets.length, 'sockets');
      for (const ws of sockets) {
        try { ws.send(data); } catch {}
      }
    } catch (err) { console.error('broadcast error:', err && err.message); }
  }

  // ── Phase 3：mutation 引擎（唯一世界變更入口）───────────────────────────
  async postMutation(type, payload, actorToken) {
    await this.ensureInit();
    payload = payload || {};
    const now = Date.now();

    // 限流：每 token 60 秒 5 次（memory Map；hibernation reset 只會放寬，可接受）
    const rlKey = actorToken || 'anon';
    const rl = this.rateLimits.get(rlKey) || { count: 0, window: 0 };
    if (now - rl.window > 60000) { rl.window = now; rl.count = 0; }
    if (rl.count >= 5) return { ok: false, status: 429, error: 'rate limit exceeded: max 5 mutations per minute' };
    rl.count += 1;
    this.rateLimits.set(rlKey, rl);

    // 驗證 + 套用（先寫 mutations audit log，再套世界變更）
    const err = this.validateMutation(type, payload);
    if (err) return { ok: false, status: 400, error: err };

    const seq = await this.nextSeq();
    this.sql.exec(
      'INSERT INTO mutations (seq, type, payload_json, actor_token, created_at) VALUES (?,?,?,?,?)',
      seq, type, JSON.stringify(payload), actorToken || null, now);

    const result = this.applyMutation(type, payload, now, actorToken);
    if (!result.ok) return { ok: false, status: 400, error: result.error };

    // 廣播俾所有連線（Phase 2）
    this.broadcast({ type: 'mutation', seq, mutation: { seq, type, payload, actorToken: actorToken || null } });
    return { ok: true, seq };
  }

  async nextSeq() {
    const meta = this.sql.exec("SELECT v FROM world_meta WHERE k = 'seq'").toArray()[0];
    const seq = (Number(meta?.v) || 0) + 1;
    this.sql.exec("INSERT OR REPLACE INTO world_meta (k,v) VALUES ('seq', ?)", String(seq));
    return seq;
  }

  // 白名單驗證（模型 + 島 + 名長度 + payload 大小）
  validateMutation(type, payload) {
    if (type === 'add_item') {
      const it = payload.item || {};
      if (!it.id || typeof it.id !== 'string' || !/^[a-z][a-z0-9\-]{1,31}$/.test(it.id)) return 'item.id invalid';
      if (!it.islandId || typeof it.islandId !== 'string') return 'item.islandId required';
      const isl = this.sql.exec('SELECT id FROM islands WHERE id = ? AND deleted_at IS NULL', it.islandId).toArray()[0];
      if (!isl) return 'island not found: ' + it.islandId;
      if (!it.model || !MODEL_WHITELIST.includes(it.model)) return 'model not allowed';
      if (!it.name || !it.name.zh || it.name.zh.length < 1 || it.name.zh.length > 24) return 'name_zh 1-24 chars';
      return null;
    }
    if (type === 'add_island') {
      const isl = payload.island || {};
      if (!isl.id || !/^news\-[0-9]{8}\-[0-9]{2}$/.test(isl.id)) return 'island.id must be news-YYYYMMDD-NN';
      if (!isl.name || !isl.name.zh || isl.name.zh.length < 1 || isl.name.zh.length > 60) return 'name_zh 1-60 chars';
      return null;
    }
    if (type === 'add_flow') {
      const f = payload.flow || {};
      if (!f.id || !/^[a-z][a-z0-9\-]{1,31}$/.test(f.id)) return 'flow.id invalid';
      if (!f.from || !f.to) return 'from/to required';
      return null;
    }
    return 'unknown mutation type: ' + type;
  }

  applyMutation(type, payload, now, actorToken) {
    if (type === 'add_item') {
      const it = payload.item;
      this.sql.exec(
        `INSERT OR REPLACE INTO items (id, island_id, no, model, name_zh, name_en, facts_json, timeline_json, src, freq, created_at, created_by, deleted_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
        it.id, it.islandId, it.no ?? 99, it.model, it.name.zh, it.name.en || it.name.zh,
        JSON.stringify(it.facts || DEFAULT_FACTS), JSON.stringify(it.timeline || DEFAULT_TIMELINE),
        it.src || '市民提案', it.freq || '即時', now, payload.actorToken || null);
      // 貢獻分：+10（actorToken 係 full hash）
      if (actorToken) {
        this.sql.exec('UPDATE users SET score = score + 10, last_seen = ? WHERE token_hash = ?',
          now, actorToken);
      }
      return { ok: true };
    }
    if (type === 'add_island') {
      const isl = payload.island;
      this.sql.exec(
        `INSERT OR REPLACE INTO islands (id, no, theme, name_zh, name_en, summary_zh, summary_en, icon, color, ang, radius, origin, news_id, created_at, created_by, deleted_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
        isl.id, isl.no ?? '99', isl.theme || 'news', isl.name.zh, isl.name.en || isl.name.zh,
        isl.summary?.zh || '', isl.summary?.en || '', isl.icon || '📰', isl.color ?? 0x9cc27a,
        isl.ang ?? null, isl.radius ?? 32, 'news', isl.newsId || null, now, actorToken || null);
      // 新聞島附帶一座地標細項（自動）
      const itemId = isl.id + '-i1';
      this.sql.exec(
        `INSERT OR REPLACE INTO items (id, island_id, no, model, name_zh, name_en, facts_json, timeline_json, src, freq, created_at, created_by, deleted_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
        itemId, isl.id, 1, isl.itemModel || 'pavilion', isl.name.zh + ' · 焦點', isl.name.en || isl.name.zh,
        JSON.stringify([{ v: 'NEW', u: { zh: '島', en: '' }, k: { zh: '新聞島', en: 'news island' } }]),
        JSON.stringify([{ d: 'now', t: { zh: '由新聞自動生成', en: 'auto-generated from news' } }]),
        '新聞自動生成', '即時', now, payload.actorToken || null);
      return { ok: true };
    }
    if (type === 'add_flow') {
      const f = payload.flow;
      this.sql.exec(
        `INSERT OR REPLACE INTO flows (id, from_island, to_island, kind, ev, updated, depts, carry_zh, carry_en, icon, note_zh, note_en, created_at, created_by, deleted_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
        f.id, f.from, f.to, f.kind || 'pending', f.ev || 'C', '2026 Q4', f.depts ?? 1,
        f.carry?.zh || '待定', f.carry?.en || 'TBD', f.icon || '📄', f.note?.zh || '', f.note?.en || '',
        now, actorToken || null);
      return { ok: true };
    }
    return { ok: false, error: 'unknown type' };
  }

  // 初始化用 blockConcurrencyWhile，避免同 request 併發時 schema 未建好。
  async ensureInit() {
    if (this.ready) return;
    return this.ctx.blockConcurrencyWhile(async () => {
      if (this.ready) return;
      this.sql.exec(SCHEMA_SQL);
      await this.seedIfEmpty();
      // 兼容舊表：users.score（遊戲改進 A：貢獻分）
      try { this.sql.exec('ALTER TABLE users ADD COLUMN score INTEGER DEFAULT 0'); }
      catch (e) { /* 已有欄位 */ }
      this.ready = true;
    });
  }

  // 只喺 world_meta 冇 seed marker 時先寫入 seed。
  // Seed SQL 喺 dist/seed.sql，由 build.py 由 migrations/0002_seed.sql 複製。
  async seedIfEmpty() {
    // 注意：DO SQLite 嘅 cursor.one() 喺零結果時會 throw
    // ("Expected exactly one result from SQL query")，所以用 toArray()[0]。
    const marker = this.sql.exec("SELECT v FROM world_meta WHERE k = 'seed'").toArray()[0];
    if (marker) return;
    const assets = this.env && this.env.ASSETS;
    if (assets && typeof assets.fetch === 'function') {
      try {
        const res = await assets.fetch(new Request('https://assets.local/seed.sql'));
        if (res && res.ok) {
          const sql = await res.text();
          if (sql && sql.trim()) {
            // seed SQL 內含多條陳述句；exec() 支援多陳述句
            this.sql.exec(sql);
            this.sql.exec("INSERT OR REPLACE INTO world_meta (k,v) VALUES ('seq','0')");
            this.sql.exec("INSERT OR REPLACE INTO world_meta (k,v) VALUES ('seed','1')");
            return;
          }
        }
      } catch (err) {
        console.error('seed load failed:', err && err.message ? err.message : err);
      }
    }
    console.warn('WorldRoom: seed.sql unavailable — world stays empty');
  }

  async getWorld() {
    await this.ensureInit();
    const islands = this.sql.exec('SELECT * FROM islands WHERE deleted_at IS NULL ORDER BY no, id').toArray();
    const items = this.sql.exec('SELECT * FROM items WHERE deleted_at IS NULL ORDER BY island_id, no, id').toArray();
    const flows = this.sql.exec('SELECT * FROM flows WHERE deleted_at IS NULL ORDER BY id').toArray();
    const meta = this.sql.exec("SELECT v FROM world_meta WHERE k = 'seq'").toArray()[0];
    const seq = Number(meta?.v ?? 0);
    return { islands, items, flows, seq: Number.isFinite(seq) ? seq : 0 };
  }

  async getIsland(id) {
    await this.ensureInit();
    const island = this.sql.exec('SELECT * FROM islands WHERE id = ? AND deleted_at IS NULL LIMIT 1', id).toArray()[0];
    if (!island) return null;
    const items = this.sql.exec('SELECT * FROM items WHERE island_id = ? AND deleted_at IS NULL ORDER BY no, id', id).toArray();
    const flows = this.sql.exec('SELECT * FROM flows WHERE (from_island = ? OR to_island = ?) AND deleted_at IS NULL ORDER BY id', id, id).toArray();
    return { island, items, flows };
  }

  async getMutations(since) {
    await this.ensureInit();
    const rows = this.sql.exec('SELECT * FROM mutations WHERE seq > ? ORDER BY seq ASC LIMIT 500', since).toArray();
    const meta = this.sql.exec("SELECT v FROM world_meta WHERE k = 'seq'").toArray()[0];
    const seq = Number(meta?.v ?? 0);
    return { mutations: rows, seq: Number.isFinite(seq) ? seq : 0 };
  }
}

export default { WorldRoom };
