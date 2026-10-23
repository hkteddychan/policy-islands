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

export class WorldRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.ready = false;
  }

  // Durable Object 內部 HTTP 入口。Worker 用 stub.fetch() 轉發（RPC 需要
  // `extends DurableObject`，呢個 class 用傳統 constructor 寫法，所以行 fetch）。
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
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

  // 初始化用 blockConcurrencyWhile，避免同 request 併發時 schema 未建好。
  async ensureInit() {
    if (this.ready) return;
    return this.ctx.blockConcurrencyWhile(async () => {
      if (this.ready) return;
      this.sql.exec(SCHEMA_SQL);
      await this.seedIfEmpty();
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
