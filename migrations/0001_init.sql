-- Phase 1 · D1 schema for Policy Islands
-- Authoritative, append-only world data. Soft deletes use deleted_at (NULL = alive).

-- ── World skeleton ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS islands (
  id           TEXT PRIMARY KEY,                 -- 'hub' | 'transport' | 'news-20261023-01'
  no           TEXT NOT NULL,                    -- display number '00'..'99'
  theme        TEXT NOT NULL,                    -- transport | education | ... | news
  name_zh      TEXT NOT NULL,
  name_en      TEXT NOT NULL,
  summary_zh   TEXT,
  summary_en   TEXT,
  icon         TEXT,
  color        INTEGER,                          -- 0xRRGGBB
  ang          REAL,                             -- ring angle in degrees; hub = NULL
  radius       REAL NOT NULL DEFAULT 22,
  origin       TEXT NOT NULL DEFAULT 'seed',     -- seed | user | news
  news_id      TEXT,                             -- -> news_items(id) when origin='news'
  created_at   INTEGER NOT NULL,                 -- epoch ms
  created_by   TEXT,                             -- users.id or NULL (system)
  deleted_at   INTEGER                           -- soft delete; NULL = alive
);
CREATE INDEX IF NOT EXISTS idx_islands_theme ON islands(theme);
CREATE INDEX IF NOT EXISTS idx_islands_live  ON islands(deleted_at, created_at);

CREATE TABLE IF NOT EXISTS items (
  id            TEXT PRIMARY KEY,                -- 'h1' | 'news-20261023-01-i1'
  island_id     TEXT NOT NULL REFERENCES islands(id),
  no            INTEGER NOT NULL,
  model         TEXT NOT NULL,                   -- archetype: hall | clinic | school | ...
  name_zh       TEXT NOT NULL,
  name_en       TEXT NOT NULL,
  facts_json    TEXT,                            -- [{v,u_zh,u_en,k_zh,k_en}]
  timeline_json TEXT,                            -- [{d,t_zh,t_en}]
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
  kind        TEXT NOT NULL,                      -- official | thematic | pending
  ev          TEXT NOT NULL,                      -- evidence grade A/B/C
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

-- ── Users / sessions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,                   -- ULID / UUID
  handle     TEXT UNIQUE,                        -- display name; anonymous = NULL
  kind       TEXT NOT NULL,                      -- anonymous | account
  token_hash TEXT NOT NULL,                      -- SHA-256(session token), never plaintext
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

-- ── Audit / anti-abuse ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mutations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  seq          INTEGER NOT NULL,                 -- globally monotonic sync sequence
  type         TEXT NOT NULL,                    -- add_island | add_item | delete_item | add_flow | ...
  payload_json TEXT NOT NULL,
  actor_id     TEXT,                             -- users.id
  actor_token  TEXT,                             -- anonymous token prefix
  created_at   INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mutations_seq ON mutations(seq);

-- ── Ingested news (deduplicated) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS news_items (
  id           TEXT PRIMARY KEY,                 -- sha256(url)[:16]
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

-- ── Small key/value world metadata (seq counter, schema version…) ──────────
CREATE TABLE IF NOT EXISTS world_meta (
  k TEXT PRIMARY KEY,
  v TEXT
);
