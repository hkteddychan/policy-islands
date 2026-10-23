# 政策島 Policy Islands — 後端架構建議

> 研究日期：2026-10-23。所有 Cloudflare 限額／價格都引自 `developers.cloudflare.com` 官方文件（頁面 last-updated 日期已標註）。
> 目標讀者：單人開發者（Linux VM 部署，Cloudflare 帳戶目前為 Workers Free 級別）。
> 本文件只做架構決策，**不含程式碼**。

---

## 0. 現況盤點（決定架構的事實）

| 事實 | 值 | 來源 |
|---|---|---|
| 現有前端 | 單檔 `index.html`（138 KB），Three.js r160 importmap，`src/*.js` 由 `build.py` 組裝 | `build.py`、`src/` |
| 現有部署 | GitHub Pages（`hkteddychan.github.io/policy-islands/`）+ 臨時 Cloudflare Worker（`--temporary`） | `README.md` |
| 現有 Worker | `worker.js`（139 KB）把 HTML 內嵌成 template literal，`fetch` handler 只回 `text/html`；無 binding、無 D1、無 DO | `worker.js`、`wrangler.jsonc` |
| `wrangler.jsonc` | 只有 `name` / `compatibility_date: 2026-10-19` / `observability` / `assets.directory: "."` | `wrangler.jsonc` |
| 靜態資料 | `ISLANDS`(7) / `ITEMS`(21) / `FLOWS`(12) / `ISL_POS` / `ISL_NODES` / `ITEM_WORLD` / `FLOW_OBJ` 全部硬編碼在 `src/01-data.js` | `src/01-data.js` |
| 小人 | 108 個 chibi walker，沿 `FLOWS` 的 Dijkstra 路徑行走（純本地動畫） | `src/05-walkers.js` |
| 專案規則 | 唔准引入新框架／打包工具；唔准加新 CDN 依賴；只改 `src/*.js`；改完要跑 `python3 build.py` | `AGENTS.md` |
| Git | **本機 `/opt/data/policy-islands` 唔係 git repo**（`fatal: not a git repository`） | 實測 |
| 磁碟 | `/opt/data` 已用 98%（114G / 117G，剩 2.5G） | `df -h` |
| 環境 | Node v26.5.1；`wrangler` 已裝於 `/opt/data/home/.local/bin/wrangler`；系統 Python 3.13.5 冇 pip | 實測 |

**關鍵推論：**

1. 現有 `worker.js` 把整個 HTML 塞進 JS 字串 → Worker bundle 已經 ~139 KB，逼近 64 MiB 但無實際壓力；不過一旦要加 API，**應該改用 Workers Static Assets**（`assets.directory`）而不是繼續內嵌 HTML — 靜態資源請求免費且無限（`workers/static-assets/billing-and-limitations/`，last updated 2026-04-23）。
2. `AGENTS.md` 禁止新框架／打包工具 → 決定了**後端必須是零依賴的原生 JS Worker**，唔好用 Hono/Drizzle/PartyKit SDK 做核心。
3. 磁碟 98% 滿 → 唔好喺本機 cache 大量新聞 HTML；新聞原文要落 R2 或直接唔存。

---

## 1. 推薦技術棧（一句话）

**Cloudflare Workers（原生 JS，零依賴）+ Durable Objects（單一「世界房間」DO，SQLite storage，WebSocket Hibernation API）+ D1（持久世界狀態嘅權威來源）+ Cron Trigger（新聞攝取）+ Workers AI（可選，標題分類）+ R2（可選，新聞原文 / 縮圖）。**

| 層 | 產品 | 角色 |
|---|---|---|
| 靜態前端 | Workers Static Assets（`index.html` + Three.js importmap） | 保留現有單檔 app，零改動部署 |
| API + 靜態檔案 | 一個 Worker（`policy-islands`），`run_worker_first = ["/api/*", "/ws/*"]` | 路由、驗證、REST |
| 即時同步 | **一個 Durable Object** `WorldRoom`（`storage: "sqlite"`，Hibernation WebSocket API） | 房間廣播、指令序列化、世界快照 |
| 權威資料庫 | **D1**（`policy-islands-main`，`--location=apac`） | islands / items / flows / users / audit，跨房間持久 |
| 定時工作 | Cron Trigger（`0 */2 * * *`） | 抓新聞 → 分類 → 生成新島 |
| 快取 | Workers KV（`news-cache`，每日 TTL） | RSS 原文 cache，避免重複抓 |
| 分類 | Workers AI（`@cf/llama-3.3-70b` 或更細模型）或純規則關鍵詞 | 決定新島主題；可先唔開 |
| 反濫用 | Turnstile（免費，20 widgets）+ Worker Rate Limiting binding | 保護「加建築」API |
| 可選 | R2 bucket `policy-islands-media` | 將來用戶上傳嘅圖片／模型 |

**為什麼唔用其他方案 → 見 §9。**

---

## 2. 數據模型草案

### 2.1 D1（權威持久層，跨房間）

```sql
-- ── 世界靜態骨架（由種子 migration 寫入，前端仍可用它做 fallback）──
CREATE TABLE islands (
  id           TEXT PRIMARY KEY,          -- 'hub' | 'transport' | ... | 'news-20261023-01'
  no           TEXT NOT NULL,             -- 顯示編號 '00'..'99'
  theme        TEXT NOT NULL,             -- transport | education | health | housing | environment | economy | 'news'
  name_zh      TEXT NOT NULL,
  name_en      TEXT NOT NULL,
  summary_zh   TEXT,
  summary_en   TEXT,
  icon         TEXT,
  color        INTEGER,                   -- 0xRRGGBB
  ang          REAL,                     -- 環形角度（度）；hub = NULL
  radius       REAL NOT NULL DEFAULT 22, -- 環半徑（新聞島用更大值向外擴）
  origin       TEXT NOT NULL DEFAULT 'seed', -- seed | user | news
  news_id      TEXT,                     -- FK -> news_items（origin='news' 時）
  created_at   INTEGER NOT NULL,         -- epoch ms
  created_by   TEXT,                     -- users.id 或 NULL（系統）
  deleted_at   INTEGER                    -- soft delete
);
CREATE INDEX idx_islands_theme ON islands(theme);
CREATE INDEX idx_islands_live ON islands(deleted_at, created_at);

CREATE TABLE items (                     -- 島上嘅「細項建築」
  id           TEXT PRIMARY KEY,          -- 'h1' | 'news-20261023-01-i1'
  island_id    TEXT NOT NULL REFERENCES islands(id),
  no           INTEGER NOT NULL,
  model        TEXT NOT NULL,             -- archetype key: 'hall' | 'clinic' | 'school' | ...
  name_zh      TEXT NOT NULL,
  name_en      TEXT NOT NULL,
  facts_json   TEXT,                     -- [{v,u_zh,u_en,k_zh,k_en}] x3
  timeline_json TEXT,                    -- [{d,t_zh,t_en}]
  src          TEXT,                     -- 資料來源
  freq         TEXT,
  created_at   INTEGER NOT NULL,
  created_by   TEXT,
  deleted_at   INTEGER
);
CREATE INDEX idx_items_island ON items(island_id, deleted_at);

CREATE TABLE flows (                     -- 12 條協作線 + 新增線
  id           TEXT PRIMARY KEY,
  from_island  TEXT NOT NULL REFERENCES islands(id),
  to_island    TEXT NOT NULL REFERENCES islands(id),
  kind         TEXT NOT NULL,             -- official | thematic | pending
  ev           TEXT NOT NULL,             -- 證據等級 A/B/C
  updated      TEXT,
  depts        INTEGER,
  carry_zh     TEXT, carry_en TEXT,
  icon         TEXT,
  note_zh      TEXT, note_en TEXT,
  created_at   INTEGER NOT NULL,
  created_by   TEXT,
  deleted_at   INTEGER
);
CREATE INDEX idx_flows_from ON flows(from_island);
CREATE INDEX idx_flows_to   ON flows(to_island);

-- ── 使用者 ──
CREATE TABLE users (
  id           TEXT PRIMARY KEY,          -- ULID/UUID
  handle       TEXT UNIQUE,              -- 顯示名；匿名用者 = NULL
  kind         TEXT NOT NULL,             -- anonymous | account
  token_hash   TEXT NOT NULL,            -- SHA-256(session token)，唔存明文
  created_at   INTEGER NOT NULL,
  last_seen    INTEGER
);
CREATE INDEX idx_users_token ON users(token_hash);

CREATE TABLE sessions (                  -- 可選：如果用 KV 存 session 就唔需要呢張表
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  expires_at   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);

-- ── 審計 / 反垃圾 ──
CREATE TABLE mutations (                 -- 所有世界變更嘅不可變日誌
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  seq          INTEGER NOT NULL,          -- 全域單調遞增序號（同步用）
  type         TEXT NOT NULL,             -- add_island | add_item | delete_item | add_flow | ...
  payload_json TEXT NOT NULL,
  actor_id     TEXT,                      -- users.id
  actor_token  TEXT,                      -- 匿名 token 前綴
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_mutations_seq ON mutations(seq);

CREATE TABLE news_items (                -- 攝取到嘅新聞（去重後）
  id           TEXT PRIMARY KEY,          -- sha256(url) 前 16 hex
  feed         TEXT NOT NULL,             -- 'rthk-local-zh' | 'info-gov-zh' | ...
  url          TEXT NOT NULL,
  title_zh     TEXT, title_en TEXT,
  summary      TEXT,
  published_at INTEGER,
  fetched_at   INTEGER NOT NULL,
  theme        TEXT,                      -- 分類結果：transport / education / ...
  score        REAL,                      -- 0..1 重要性
  island_id    TEXT,                      -- 如果已經生成咗島
  raw_json     TEXT
);
CREATE INDEX idx_news_fetched ON news_items(fetched_at);
CREATE UNIQUE INDEX idx_news_url ON news_items(url);

CREATE TABLE island_generation_log (     -- 防止 cron 暴衝 / 追審計
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  news_id      TEXT NOT NULL,
  island_id    TEXT,
  created_at   INTEGER NOT NULL
);
```

### 2.2 Durable Object（`WorldRoom`）內部狀態

DO 唔做長期權威，佢做 **即時一致性層**：

```
// in-memory（可重建，唔係權威）
rooms: Map<roomId, {
  sockets: Set<WebSocket>,
  clients: Map<clientId, { userId, island_id, x, z, t, seq }>
}>

// ctx.storage.sql（持久，快照用；用 D1 做權威）
CREATE TABLE world_meta (k TEXT PRIMARY KEY, v TEXT);
  -- 'version' -> 世界版本號（整數，每次 mutation +1）
  -- 'seq'     -> 已分配嘅最後序號
CREATE TABLE world_snapshot (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  version    INTEGER NOT NULL,
  seq        INTEGER NOT NULL,
  payload    TEXT NOT NULL,   -- 完整世界 JSON（islands/items/flows）
  updated_at INTEGER NOT NULL
);
```

**關鍵設計點：** DO 內部用 `ctx.storage.sql` 存**世界快照**，用 D1 存**權威資料**。兩者唔重複寫——DO 每次 mutation：
1. 驗證 + 分配 `seq`（單調遞增，DO 單執行緒保證）
2. 寫入 D1（權威，冇 `BEGIN` 語句，靠 batch 原子性）
3. 更新 DO 內部 `seq` counter（`ctx.storage.sql` 一次 UPDATE）
4. 廣播 `{type:'mutation', seq, payload}` 俾所有 socket
5. 每 N 次 mutation 或每 60 秒，寫一次 `world_snapshot`

---

## 3. API Surface

所有 API 同一個 Worker 服務，`/api/*` 走 Worker，`/ws` 走 DO。

### 3.1 REST（HTTP JSON）

| Method | Path | Auth | 說明 |
|---|---|---|---|
| `GET` | `/api/world?since=<seq>` | 公開 | 回傳 `{version, seq, islands[], items[], flows[]}`。`since` 有值就只回增量 |
| `GET` | `/api/islands/:id` | 公開 | 單島 + items |
| `GET` | `/api/news` | 公開 | 已攝取新聞列表（最近 N 條） |
| `GET` | `/api/health` | 公開 | liveness + build version |
| `POST` | `/api/session` | 公開 | 發匿名 session token（`POST` 太多需要 Turnstile） |
| `POST` | `/api/session/claim` | anon token | 匿名 → 具名帳號（可選，Phase 3） |
| `POST` | `/api/mutations` | token | 建立世界變更（add_item / delete_item / add_flow / add_island） |
| `GET` | `/api/mutations?since=<seq>` | 公開 | 增量拉取（WebSocket 斷線後補洞） |
| `GET` | `/api/leaderboard` | 公開 | 貢獻排名（可選） |

**`POST /api/mutations` 契約（草稿）：**

```jsonc
// request
{
  "type": "add_item",
  "id": "u-7f3a2b",              // client 生成，冇就 server 生成
  "island_id": "transport",
  "model": "clinic",
  "name": {"zh": "社區診所", "en": "Community Clinic"},
  "facts": [{"v":"12","u_zh":"間","u_en":"","k_zh":"診所數","k_en":"clinics"}],
  "timeline": [{"d":"2026 Q4","t_zh":"...","t_en":"..."}]
}

// response 202
{
  "ok": true,
  "seq": 1284,                    // 由 server 分配
  "id": "u-7f3a2b",
  "version": 91
}
```

**規則（server 端強制）：**
- `model` 必須係前端 archetype 白名單（`hall`/`clock`/`stage`/`clinic`/`school`/...）— 唔接受任意幾何／任意 code，**避免 XSS + 避免客戶端塞爆場景**。
- `name.zh` / `name.en` 長度 ≤ 64；`facts` 最多 3 條；`timeline` 最多 5 條。字串全部 HTML-escape（前端用 `textContent` 插入）。
- 每個 user 每 60 秒最多 5 次 mutation（Rate Limiting binding，per-token）。
- 總 items 上限 500、全域 islands 上限 40 — 超過就拒絕（保護 DO 廣播 payload 大小 + D1 rows written 配額）。

### 3.2 WebSocket（`/ws`）

```
Client → Server:
  {t:'hello', token, room:'main', last_seq:1280}
  {t:'add_item', ...}            // 同 REST 契約
  {t:'del_item', id:'u-7f3a2b'}
  {t:'presence', x, z, ang, island_id}
  {t:'ping'}

Server → Client:
  {t:'welcome', seq, version, islands[], items[], flows[], you:{id}}
  {t:'mutation', seq, type, payload, actor}
  {t:'presence', clients:[{id,x,z,ang,island_id}]}   // 節流 10Hz
  {t:'error', code, message}
  {t:'pong'}
```

**Presence 唔入 D1** — 只存在 DO in-memory，掉線即消失（需求係「大家見到對方喺邊」，唔係永久社交檔案）。

---

## 4. 即時同步策略

### 4.1 選：DO WebSocket + Hibernation API

**為什麼：**

- **單一權威房間**。政策島係一個共享世界，所有人睇同一個場景 → 一個 DO（`idFromName('main')`）做單點序列點，天然避免「兩個寫入者同時改」的競態。
- **Hibernation 消除按連接計費**。`acceptWebSocket()` 而唔係 `ws.accept()` → 閒置 10 秒後 DO 會 hibernate，客戶端 WebSocket 保持連線，**不計 duration 費用**（`durable-objects/best-practices/websockets/`，last updated 2026-09-30；`durable-objects/platform/pricing/` footnote 4）。
- **免費計費比率友好**。入站 WebSocket message 計費有 **20:1 折扣**（100 條入站 message 只當 5 個 request 計），出站 message 唔計 request。對本 app 完美 —— mutation 係稀疏事件，唔係高頻。
- **無需自己搞心跳**。Hibernation 狀態下 protocol-level ping 由 runtime 免費處理。
- **成本可預測**。DO 計費：Free 計劃 100,000 requests/日 + 13,000 GB-s/日；Paid $5/月包含 1M requests + 400,000 GB-s。

**為什麼唔用 `ws.accept()`：** 一個 WorldRoom 長期在線，唔 hibernation 就要按 128 MB × wall-clock 計 duration 費用。Cloudflare 官方 billing example 明確指出 hibernation 對 broadcast 場景（"game, chat or real-time user state"）能大幅降低成本。

### 4.2 同步模型：Seq-based 增量 + 定時全量快照

```
Client                                   Server (DO)
  │──── ws connect /ws?last_seq=N ─────────►│
  │◄─── welcome{seq:N+1, world snapshot} ───│   (若 N 太舊 → 回全量)
  │
  │──── add_item{...} ─────────────────────►│
  │                                       ├─ validate
  │                                       ├─ seq = ++counter
  │                                       ├─ D1.batch([...])     ← 權威寫入
  │                                       ├─ broadcast mutation ──┼──► 所有 socket
  │◄─── mutation{seq, payload} ────────────┤
  │
  │◄─── presence{clients[]} (10Hz 节流) ────┤
```

**客戶端重連策略（must-have）：**
1. `ws` onclose → 指數退避重連（1s → 2s → 4s → max 30s + jitter）。
2. 重連時帶 `last_seq`；server 若 `last_seq` 已在 snapshot 覆蓋範圍就只發增量，否則發全量 snapshot。
3. 客戶端**冇收到 mutation 就唔會更新 3D 場景** — 收到 `mutation` 後 → 套用 → `STATE.dirty = true`（沿用 `AGENTS.md` 規則 8）。
4. REST `GET /api/mutations?since=N` 作為最終 fallback（例如 WS 被中間商擋、但 HTTP 通）。

### 4.3 為什麼唔用 SSE / polling

- **SSE 是單向**。用戶「加建築」需要 client → server 雙向。SSE + POST 是可以，但等於兩條通道、兩個錯誤處理路徑。
- **Polling 有延遲上限**。即使 2 秒一次，mutation 也要 2 秒先反映到其他人畫面；而且 10 個用戶 × 0.5 req/s = 5 req/s，Worker 免費層 100,000 req/日 只夠撐 ~5.5 小時。WS 連接只算 1 個 request。
- **Cloudflare Worker 免費層的 request 配額是本 app 最大的隱形牆**（見 §8）。

### 4.4 為什麼唔用第三方（Ably / Pusher / Liveblocks / PartyKit）

- **PartyKit** 其實就係 DO + SDK。但它要求 npm 依賴、TS toolchain、`partykit deploy` — 違反 `AGENTS.md` 規則 5（唔准加新框架／打包工具）。原生 DO 只要 ~100 行 WebSocket 邏輯。
- **Ably / Pusher** 係 pub/sub，唔係持久狀態 store。要自己再搭 D1 做權威 → 多一份 vendor 依賴 + 多一份錢，而且 200 connection free tier 對「增長到 40 座島」唔夠。
- **Liveblocks** 對 presence 好好，但係 SaaS、多供應商、而且離線行為要額外處理。

**成本對比（50 個用戶、每人 1 分鐘 1 次 presence）：**
- Ably Free：3M msgs/mo 覆蓋到，但 200 concurrent connections 上限太低。
- 自建 DO：50 WS 連接 = 50 requests；message 20:1 → 實際計 ~2.5 requests/min/user → 50 users ≈ 3,750 requests/日，遠低於 100,000/日免費額度。

---

## 5. 驗證策略

### 5.1 匿名優先（Phase 1-2），帳號可選（Phase 3）

**推薦：匿名 session token 為主，帳號係加糖。**

**匿名 token 流程：**
1. Client 首次載入 → `POST /api/session` → server 生成 32-byte 隨機 token，**只回傳一次**。
2. Server 存 `sha256(token)` 喺 D1 `users.token_hash`；client 存喺 `localStorage`。
3. 每個 mutation 帶 `Authorization: Bearer <token>`；server 用 hash lookup。
4. Token 有 device metadata（user-agent hash、首次時間）但**唔收集 PII**。

**點解唔一開始就要帳號：**
- 需求只係「用戶可以加元素，大家見到」— 冇需要 email / 密碼 / 第三方 OAuth。
- 帳號會把轉化率從 100% 拉低。政策島係個視覺 demo，唔係 SaaS。
- 帳號 = PII = GDPR/PDPO 合規負擔 + 更多 auth bug 面積。

**點解唔「完全冇驗證」：**
- 完全匿名 = 任何人都可以無限次改世界 = 世界被搞壞。
- 匿名 token 已經提供：**可歸因（審計）、可限流（Rate Limiting binding 用 token hash 做 key）、可撤銷**。

**Phase 3 可加的帳號（唔阻礙前面）：**
- `POST /api/session/claim` — 用現有 token 換一個具名 handle（`handle` + 之後可選 email/password）。
- OAuth：Cloudflare Access / OpenAuth（Workers KV 存 session — `workers/platform/storage-options/` 明確建議 KV 做 session storage）。
- **注意**：唔好用 Workers KV 存「世界狀態」— KV 有 **1 write/秒 per key** 限制，而且 eventually consistent。

### 5.2 Token 儲存位置

| 用途 | 位置 | 理由 |
|---|---|---|
| Session token（明文） | Client `localStorage` | 需要跨 reload 保留；XSS 風險已由嚴格 CSP + 只輸出 escaped 文字緩解 |
| token hash | D1 `users.token_hash` | 洩漏時無法直接冒用 |
| 高頻 session lookup | Workers KV（可選，TTL 30 分鐘） | 如果 D1 read rows 太多，用 KV 做 token→user 快取（KV 免費層 100,000 reads/日，夠用） |
| 世界狀態 | D1 + DO | 見上 |

### 5.3 反濫用

- **Worker Rate Limiting binding**：`rateLimit({ key: tokenHash })` — `limit` / `period` 由 binding 定義（`period` 只可以是 10 或 60 秒）。**注意計數係 per Cloudflare location 而唔係全域**，而且官方明確講「requests can exceed your configured limit before those updates arrive」（分佈式計數器同步有窗口），所以只可以當**快速拒絕**用，唔可以當成硬性配額。
- **Turnstile**：免費計劃 20 widgets、unlimited challenges。用於 `POST /api/session`（防止有人 script 大量開 session）同高風險操作。
- **DO 端二次檢查**：DO 係單執行緒 + 全域唯一 → 可以做**真正全域**計數（用 `ctx.storage.sql` 的 `mutation_budget` 表），比 Worker 層的本地計數準得多。**推薦以 DO 端為準**，Worker 層 Rate Limiting 只作第一道快速拒絕。

---

## 6. 新聞攝取 → 自動生成新島 Pipeline

### 6.1 Cron Trigger

```jsonc
// wrangler.jsonc
"triggers": { "crons": ["0 */2 * * *"] }   // 每 2 小時，UTC
```

- Cron Trigger **wall time 上限 15 分鐘**，CPU time：Paid 計劃 30 秒（cron 間隔 < 1 小時）或 15 分鐘（≥ 1 小時）。我哋用 2 小時間隔 → **15 分鐘 CPU 額度**，非常充裕。
- Cron 執行喺 UTC。

### 6.2 流程

```
Cron (每 2h, UTC)
  │
  ├─1. 取 RSS（Workers KV 快取，TTL 6h，避免重複抓）
  │     feeds:
  │       zh: https://rthk9.rthk.hk/rthk/news/rss/c_expressnews_clocal.xml        ✓實測 200
  │           https://rthk9.rthk.hk/rthk/news/rss/c_expressnews_cfinance.xml       ✓實測 200
  │           https://rthk9.rthk.hk/rthk/news/rss/c_expressnews_cinternational.xml ✓實測 200
  │           https://www.info.gov.hk/gia/rss/general_zh.xml   (政府新聞公報)      ✓實測 200 (352KB)
  │       en: https://rthk9.rthk.hk/rthk/news/rss/e_expressnews_elocal.xml        ✓實測 200
  │           https://rthk9.rthk.hk/rthk/news/rss/e_expressnews_efinance.xml       ✓實測 200
  │           https://www.info.gov.hk/gia/rss/general_en.xml                        ✓實測 200 (447KB)
  │     ⚠ c_expressnews_cgreaterchina.xml 302 → HTML（實測），唔用
  │     ⚠ info.gov.hk general_tc.xml 404（實測），中文用 general_zh.xml
  │
  ├─2. Parse RSS（手寫 tiny XML parser 或 regex on <item>）
  │     - 抽 title / link / description / pubDate
  │     - 用 sha256(url) 做 news_items.id 做去重
  │
  ├─3. 分類 + 評分（見 §6.3）
  │
  ├─4. 決定係咪生成新島（見 §6.4 gating）
  │
  ├─5. 生成 island + items + flows → 寫 D1（權威）
  │
  ├─6. 通知房間：向 WorldRoom DO 發 RPC（stub.broadcastNewIsland(...)）
  │     → 所有連線中的 client 即時收到 mutation
  │
  └─7. 寫 island_generation_log
```

### 6.3 分類：兩級策略

**Tier 1（必做，零成本）：規則關鍵詞**
一張 `theme → keywords` 表，覆蓋 6 個主題 + 通用：

```
transport: 巴士, 交通, 運輸, 道路, 隧道, 單車, 車費, 地鐵, bus, traffic, road, rail
education:  學校,  教育,  學生,  課堂,  教師,  學費,  考試, school, student, education
health:     醫院,  診所,  衞生,  健康,  醫護,  長者,  疫苗, hospital, clinic, health
housing:    房屋,  屋苑,  公屋,  租務,  安置,  樓價, housing, estate, rent
environment:環保,  環境,  綠化,  減排,  堆填,  噪音,  空氣,  河道, environment, green, carbon
economy:    經濟,  稅,    財政,  就業,  消費,  統計,  關稅, economy, tax, budget, jobs
```

匹配方式：標題 + 摘要做 substring match（中文字冇 word boundary，用 substring 反而合理）。取命中最多嘅主題。

**Tier 2（可選）：Workers AI**
`@cf/llama-3.3-70b-instruct` 或更細模型做 zero-shot 分類 + 一句摘要 + 重要性評分。
- 價格：**$0.011 / 1,000 Neurons**，免費配額 **10,000 Neurons/日**（`workers-ai/platform/pricing/`，last updated 2026-10-20）。
- 每日 2 次 cron × 每次 ~40 篇新聞 × ~500 neurons ≈ 40,000 neurons/日 → **超出免費額度**，約 $0.33/月。完全可接受，但**建議先開 Tier 1**，用 AI 只做「升級摘要」而唔係門檻判斷。
- **注意**：Workers AI 會不會用用戶新聞做 training，要喺 UI 註明。用 public news feed 就唔涉及個人資料。

### 6.4 生成新島嘅 gating（避免世界爆炸）

**硬規則：**

| 規則 | 值 | 理由 |
|---|---|---|
| 每日最多新增島 | 3 | 7 → 最多 ~10 日變 ~37 座。太多會炸視覺同 D1 |
| 每次 cron 最多新增島 | 1 | 避免一次爆發 |
| 全域島上限 | 40 | 超過就停（客戶端仍可加建築，但唔加新島） |
| 同一 feed 連續命中同一主題 | 跳過 | 避免「3 篇交通新聞 → 3 座交通島」 |
| 最低重要性分數 | 0.6 | 過濾雜訊新聞 |
| 新島必須有 ≥1 個官方來源 | `info.gov.hk` 或 `rthk` | 政府新聞公報最有權威 |

**重要性評分（規則式，避免 AI 依賴）：**
```
score = 0.3·(命中主題關鍵詞數 / 3)
      + 0.3·(來源權重: info.gov.hk=1.0, rthk=0.7, 其他=0.4)
      + 0.2·(標題含政策詞: 政策/計劃/措施/改革/launch/policy/scheme/reform → 1)
      + 0.2·(描述長度 > 80 字 → 1)
```

### 6.5 新島生成規則（要同 3D 場景一致）

現有幾何（實測 `src/`）：`ISL_R = 22`（6 座環島中心喺 r=22）、`ISL_RAD = 7.4`（六角島半徑）→ **現有島群外緣 r = 29.4**。地形盆地喺 `smoothstep(28, 38)` 放開、環狀山由 `smoothstep(40, 55)` 開始。

**結論：3D 場景幾乎冇位放新島**（新島中心安全區只有 r ≈ 30–34，最多 1-2 座）。所以：

**🥇 推薦方案：新島主要存在於 2D 地圖視圖（新增），3D 只保留核心 7 島 + 可選 1-2 座外圈島。**

- 新島唔加入主環（唔改 `ISL_R = 22`、唔改 `ISLANDS[].ang`）。
- 2D 地圖視圖用圓形 SVG 排版：核心 7 島喺內圈，新聞島喺外圈按 `32 + 7×n` 排列，顏色跟 `theme`。
- 如果要喺 3D 放最多 1-2 座，中心 r = 31，**並且唔好自動連 flow**（會改 walker 路徑）。
- 詳細取捨 + 地形常數改法見 **§11 Risk 1**。

**新島內容規則：**

| 欄位 | 值 |
|---|---|
| `id` | `news-<YYYYMMDD>-<NN>` |
| `theme` | 分類結果（交通/教育/醫療/房屋/環境/經濟） |
| `name_zh` | AI 摘要前 8 字 或 標題前 12 字（去 HTML） |
| `name_en` | AI 摘要首句 或 英文標題前 40 字 |
| `icon` / `color` | 跟 `theme`（沿用現有 `PAL` 色票） |
| `radius` | 2D 地圖用；3D 用固定 7.4 |
| `origin` | `'news'` |
| `news_id` | FK → `news_items.id` |
| `items` | 1-3 個，用現有 archetype `model` key（`clinic`/`school`/`hall`/...），名稱來自 AI 摘要 |
| `flows` | **Phase 4 先唔自動連**（見 Risk 1 緩解 5） |

> ⚠️ **實作注意**：`AGENTS.md` 規則 7 禁止改 `ISLANDS` / `ITEMS` / `FLOWS` / `ISL_POS` / `ISL_NODES` / `ITEM_WORLD` / `FLOW_OBJ` 嘅**結構名稱**。要用擴展模式：
> ```js
> const ISLANDS = [...SEED_ISLANDS, ...(serverIslands || [])];
> ```
> 而 `ISL_POS` 嘅計算要同時處理「有 `ang` 嘅環島」同「有 `radius` 嘅衛星島」兩種情況。

---

## 7. 什麼留喺前端，什麼搬去後端

| 能力 | 前端（保留） | 後端（新增） | 理由 |
|---|---|---|---|
| 3D 場景渲染 | ✅ | | 純 client-side GPU |
| 日夜循環 | ✅ | | 每個 client 自己嘅時鐘（純視覺） |
| 108 個 walker 動畫 | ✅ | | 純裝飾；唔應該上網（108 個 walker × 位置更新 = 巨大流量） |
| Dijkstra 路徑計算 | ✅ | | 只喺 flow graph 改變時重算，唔係每幀 |
| 相機控制 / 選中 / 標籤避讓 | ✅ | | 純 client |
| **主題 / 島 / 細項 資料** | ✅（seed snapshot） | ✅（權威） | 前端保留種子做離線 fallback |
| **使用者新增建築** | 發起 mutation | 驗證 + 持久化 + 廣播 | |
| **刪除建築** | 發起 mutation | 驗證 + 持久化 + 廣播 | |
| **Presence（人在邊）** | 渲染 | 10Hz 節流廣播 | |
| **新聞抓取 / 分類** | | ✅ | server 有網絡、有 secret、有排程 |
| **新島生成** | | ✅ | 必須由單一權威決定，否則各 client 唔一致 |
| **審計 / 限流 / 反垃圾** | | ✅ | |
| **本地語言 (i18n)** | ✅ | | 繁中/英文文案保留喺前端（規則 6） |
| **使用者上傳圖片** | | R2 | Phase 4，先唔做 |

**關鍵原則：後端只送「差異」（diff / mutation），唔送「全場景」。** 現有場景 ~138 KB HTML + 21 個 items + 12 條 flows；全部喺前端。所以每次 mutation 只需要送一個小 JSON object（~200 bytes）。WebSocket 每次 mutation 廣播 = 200 bytes × N 用戶，成本可忽略。

---

## 8. Cloudflare 帳戶 Footprint + 成本 / 限額風險

### 8.1 帳戶資源清單

| 資源 | 名稱 | 類型 | 備註 |
|---|---|---|---|
| Worker | `policy-islands` | Workers (Static Assets) | `assets.directory: "./cf-dist"`（`cf-dist/` 已存在並有 `index.html`），`run_worker_first: ["/api/*", "/ws"]` |
| Durable Object | `WorldRoom` | DO, `storage: "sqlite"` | 單一房間 |
| D1 | `policy-islands-main` | D1 | `--location=apac`（用戶在 HK）。⚠️ 實測：現有 wrangler 只接受 `weur / eeur / apac / oc / wnam / enam`（`wrangler d1 create --help`）；`apac-ne` / `apac-se` 只係出現喺 docs 變更 diff，未喺呢版 wrangler 生效 → **用 `apac`**。1 個 database 就夠，唔好過度分片 |
| Workers KV | `news-cache` | KV | 只存 RSS 原文，TTL 6h |
| Cron | `0 */2 * * *` | Cron Trigger | 帳戶上限 Free 5 / Paid 250 → 用 1 個 |
| Rate Limit | `MUTATION_LIMIT` | Rate Limiting binding | `limit` / `period` 由你設定；`period` 只可以是 10 或 60 秒；計數係 **per Cloudflare location**（唔係全域），要精確就要靠 DO 端 |
| Turnstile | `policy-islands` | Widget | 免費計劃，20 widgets 上限 |
| Workers AI | (binding `AI`) | 可選 | Tier 2 分類 |
| R2 | `policy-islands-media` | 可選 | Phase 4 |

### 8.2 免費 vs Paid 限額對照

| 產品 | Workers **Free** | Workers **Paid** ($5/月) |
|---|---|---|
| Worker requests | 100,000/日 | 10M/月 + $0.30/M |
| Worker CPU / request | 10 ms | 5 分鐘（預設 30 秒） |
| Worker memory | 128 MB | 128 MB |
| Subrequests / request | 50 | 10,000 |
| 同時出站連線 | 6 | 6 |
| Cron Triggers / 帳戶 | 5 | 250 |
| Cron wall time | 15 分鐘 | 15 分鐘 |
| Cron CPU | 10 ms | 30 秒（間隔<1h）/ 15 分鐘（間隔≥1h） |
| **DO requests** | 100,000/日 | 1M/月 + $0.15/M |
| **DO duration** | 13,000 GB-s/日 | 400,000 GB-s/月 + $12.50/M GB-s |
| **DO SQLite rows read** | 5M/日 | 25B/月 + $0.001/M |
| **DO SQLite rows written** | 100,000/日 | 50M/月 + $1.00/M |
| **D1 rows read** | 5M/日 | 25B/月 + $0.001/M |
| **D1 rows written** | 100,000/日 | 50M/月 + $1.00/M |
| **D1 storage** | 5 GB 總 | 5 GB 包含 + $0.75/GB-月 |
| D1 database 大小 | 500 MB | 10 GB |
| D1 Time Travel | 7 日 | 30 日 |
| D1 queries / Worker invocation | 50 | 1,000 |
| **KV reads** | 100,000/日 | 無限 |
| **KV writes（同 key）** | 1/秒 | 1/秒 |
| **KV writes（不同 key）** | 1,000/日 | 無限 |
| KV storage / namespace | 1 GB | 無限 |
| KV 最低 cacheTtl | 30 秒 | 30 秒 |
| Queues ops | 10,000/日 | 1M/月 + $0.40/M |
| Turnstile | 免費，20 widgets | 同 |
| Workers AI | 10,000 Neurons/日 | 同 + $0.011/1,000 |
| Browser Run | 10 分鐘/日 | 10 小時/月 + $0.09/hr |
| Hyperdrive queries | 100,000/日 | 無限 |

*來源：`workers/platform/limits/` (2026-10-12)、`durable-objects/platform/limits/` (2026-06-01)、`durable-objects/platform/pricing/` (2026-10-18)、`d1/platform/limits/` (2026-04-21)、`d1/platform/pricing/` (2026-04-21)、`kv/platform/limits/` (2026-10-08)、`queues/platform/limits/` (2026-04-21) + pricing、`workers/platform/pricing/` (2026-10-02)、`workers-ai/platform/pricing/` (2026-10-20)、`browser-run/pricing/` (2026-04-21)、`hyperdrive/platform/pricing/` (2026-06-18)、`turnstile/plans/` (2026-08-14)。*

### 8.3 成本估算

**假設：50 個活躍用戶，每人每分鐘 1 次 presence（60 msg/min），平均每 10 分鐘 1 次 mutation，2 小時一次 cron。**

| 項目 | 計算 | 月成本 (Paid) |
|---|---|---|
| Workers Paid 底費 | — | $5.00 |
| Worker requests | 靜態檔案請求免費且無限；WS upgrade 50/日 → ~1,500/月；REST ~2,000/月 → **~3,500 req** | $0（10M 包含） |
| Worker CPU | 每 request ~2 ms → 7,000 ms/月 | $0（30M ms 包含） |
| DO requests | WS 連接 1,500/月 + 入站 message (50 users × 60/min × 60% 活躍 × 30日 × 60 min) = 3.24M msg ÷ 20 = 162K → **~164K** | $0（1M 包含） |
| DO duration | Hibernation → **≈ 0** | $0 |
| DO SQLite rows | 寫入：每 mutation ~4 rows → 50 users × 6/h × 24 × 30 = 216K mutations/月… 太多 → 需限流到 5/min/user ⇒ 實際 ~1M rows/月；讀取 ~500K | $0（50M/25B 包含） |
| D1 rows | 同上量級 | $0 |
| KV | RSS cache：12 feeds × 12 次/日 × 30 = 4,320 reads/月；寫入 ~1,440 | $0（100K/日 免費） |
| Workers AI (Tier 2) | 40,000 neurons/日 | ~$0.33 |
| Turnstile | 免費 | $0 |
| **合計** | | **~$5.33/月** |

**結論：$5/月 Workers Paid 計劃已經完全覆蓋。** 免費計劃**唔夠**（原因見 Risk 2）。

**成本爆炸點：** 唔係 AI，係 **DO duration**。如果用 `ws.accept()` 而唔 hibernation，一個長期在線嘅 WorldRoom = 128 MB × wall-clock → 按 GB-s 計。假設 24 小時在線：`128 MB × 86,400 s ≈ 11,059 GB-s/日` → **超出免費 13,000 GB-s/日 只剩 15% 空間**，加多幾個房間或者多個 tab 就爆。所以 **hibernation 唔係優化，係必需**。

### 8.4 成本 / 限額風險

| # | 風險 | 觸發條件 | 緩解 |
|---|---|---|---|
| A | **Workers Free request 配額** | 靜態檔案請求免費，但**每個 WS upgrade + 每個 REST + 每個 API 請求都計** | 立刻上 Workers Paid（$5） |
| B | **D1 rows written 配額** | 每個 mutation 寫 ~4-6 rows（island + item + mutation log + index） | 免費 100K/日 = ~20K mutation/日。限流 5/min/user 已綽綽有餘。索引寫入會加倍計數 → 少啲索引 |
| C | **D1 是單執行緒** | 所有 mutation 排隊。1 ms query → ~1,000 qps 上限 | 唔會到達；但 `batch()` 合併查詢 |
| D | **D1 冇跨 statement 交易** | D1 唔支援 `BEGIN`/`COMMIT` | 用 `db.batch([...])` 做原子性多 statement |
| E | **KV 1 write/秒 per key** | 唔可以用 KV 做世界狀態 | 世界狀態用 D1；KV 只做 append-only cache |
| F | **D1 read replication 要用 Sessions API** | 唔用 `withSession()` 全部查詢都打 primary | 現階段唔開 replication（單 primary 夠）；開嘅話必須記住用 session |
| G | **Workers CPU 10 ms (Free)** | Parse 447KB RSS XML + 分類一定超 | Paid 計劃 30 秒 |
| H | **Cron 改動要 15 分鐘傳播** | 加新 cron trigger 後唔即刻生效 | 部署後預留 15 分鐘再驗證 |
| I | **DO 冇 explicit transaction** | `BEGIN` 被 runtime 擋 | 用 `ctx.storage.transactionSync()` |
| J | **本機磁碟 98% 滿** | 部署／cache 寫唔入 | 部署前清理；唔喺本機存新聞 |
| K | **Workers runtime 更新會斷 WS** | 部署新版本時舊連線有 20 分鐘 grace period | 客戶端重連邏輯必須容錯（§4.2） |
| L | **無 git repo** | 冇 rollback 手段 | Phase 0 必須 `git init` + commit |

---

## 9. 為什麼拒絕其他方案（每個 3-4 條）

### 9.1 資料庫

**❌ Workers KV**
- 1 write/秒 per key 硬限制 → 多人同時加建築必然撞牆
- Eventually consistent → 兩個用戶同時加嘢，可能互相覆蓋
- 冇 transaction、冇 secondary index、冇 SQL
- 冇 row-based billing（用 KB），但操作計費唔透明

**❌ 純 Durable Objects 存晒所有嘢（冇 D1）**
- 每個 DO 嘅 SQLite 係**私有**（其他 object 讀唔到）→ 跨房間查詢要自己寫 fan-out
- 冇成熟嘅 migration / schema 管理工具（要自己寫）
- 冇 HTTP API 給外部工具查（管理後台、analitics）
- 10 GB per object、免費 5 GB 帳戶總量

**❌ 外部 Postgres + Hyperdrive**
- Hyperdrive 自己要連一個你另外買嘅 Postgres（Neon/PlanetScale ~$20-30/月起）→ 成本 5 倍
- 增加外部依賴 + 網絡延遲（Workers → Postgres 單跳 ≥ 30 ms）
- 需要自己處理 connection pool、migration、備份
- 對 21 個 item、7 座島呢種規模係殺雞用牛刀

**❌ `node:sqlite` 直接喺 Worker 用**
- **實測確認：node:sqlite 喺 Workers 只係 import-only stub，唔係真實實現。** `workers/runtime-apis/nodejs/` 將 `node:sqlite` 列喺「Non-functional stub modules」，enable flag `enable_nodejs_sqlite_module`（2026-01-29 起）。workerd issue #6878 顯示 `DatabaseSync`/`StatementSync` **未 constructible**。
- 即使將來做到，因為 `node:sqlite` 係**同步** API，只可以喺 DO 內部用（唔可以喺普通 Worker 用遠端 DO 做持久 DB）。
- 結論：喺 Workers 上，**持久 SQL 只有兩條路：D1 或 DO 嘅 `ctx.storage.sql`**。

### 9.2 即時同步

**❌ SSE / 長輪詢**
- SSE 單向 → 加建築要另開一條 POST 通道
- 輪詢延遲 ≥ 輪詢間隔；2 秒 poll × 10 用戶 = 免費層 2.5 小時就爆 request 配額
- SSE 喺 Cloudflare Workers 需要 `stream()` 手動管理 keep-alive，DO 又唔支援 hibernation → 同樣有 duration 計費問題

**❌ 第三方（Ably / Pusher / Liveblocks / PartyKit）**
- **PartyKit**：要求 npm + TS toolchain + 自己的 `partykit deploy` 流程 → 違反 `AGENTS.md` 規則 5；而且 PartyKit 底下就係 DO，抽象層加咗但冇加值
- **Ably / Pusher**：純 pub/sub，冇持久狀態 → 仲要 D1 做權威 = 雙重系統、多一份 vendor lock-in、200 connection free tier 唔夠
- **Liveblocks**：presence 好好但係 SaaS，offline queue / conflict resolution 要額外處理
- 共同問題：對呢個只有「加建築」一種 mutation 嘅 app，引入多供應商 = 多一份失敗模式 + 多一份錢

### 9.3 驗證

**❌ 一開始就要完整帳號（email/password 或 OAuth）**
- 轉化率：視覺 demo 唔應該攔住用戶
- 合規成本：PII → PDPO/GDPR
- 工程成本：session 管理、password reset、email 發送（又要 Queues / Workers AI 集成）
- 匿名 token 已經解決 90% 問題（歸因 + 限流 + 撤銷）

**❌ 完全冇驗證**
- 世界係公共可寫 → 任何人都可以洗版
- 冇辦法限流（冇 key）、冇辦法審計、冇辦法撤銷濫用者

### 9.4 新聞 pipeline

**❌ GitHub Actions cron**
- 原本個 project 已經用 GHA cron 做過鏡像（見 cloudflare-workers skill），但 GHA 有 6 小時排程延遲、冇原生邊緣位置、而且要 commit 落 repo → 每次加島都要 git write（`AGENTS.md` 規則 11 禁止 git commit）
- Cloudflare Cron Trigger 喺邊緣、UTC 精準、冇 git 依賴
- GHA 免費額度係 2000 分鐘/月，一個 Scraping job 很容易食晒

**❌ 純規則分類（唔用 AI）**
- 中文新聞無空格分詞，substring 規則嘅假陽性率高（「醫」字可能係醫院亦可能係醫生亦可能係醫療券）
- 摘要生成用規則做唔到

→ **結論：Tier 1 規則做「粗篩 + 去重 + 安全閘」，Tier 2 AI 做「精分類 + 摘要」。AI 唔做閘門，只做豐富化。**

---

## 10. 分階段遷移計劃（保持現有 static app 全程可用）

### Phase 0 — 準備（0.5 天）— **不改任何 runtime 行為**
- `git init` + 首次 commit（**而家冇 repo，冇 rollback 手段 —— 最大嘅即時風險**）
- 清理磁碟（98% 滿），確保有 ≥ 5 GB 空間
- 確認 CF API token 有 Workers + D1 + DO + KV + Cron scope（用 `cloudflare-workers` skill 嘅 probe ladder）
- 開 **Workers Paid**（$5/月）— 免費層嘅 10 ms CPU 做唔到 RSS parse + AI 分類
- 開一個專用 CF account 命名空間 note，記錄 account id

**驗收**：`git log` 有 commit；`wrangler whoami` 顯示帳戶；Workers 計劃 = Paid。

### Phase 1 — 資料層 + 只讀 API（1 天）
- `wrangler d1 create policy-islands-main --location=apac`
- 寫 `migrations/` SQL（§2.1 全部表），用 `wrangler d1 migrations apply` 執行
- 寫 seed migration：由 `src/01-data.js` **自動生成** INSERT（用 Node 讀 `src/01-data.js` 抽取 ISLANDS/ITEMS/FLOWS → JSON → 轉 SQL），避免手抄出錯
- Worker 加 `GET /api/world`、`GET /api/health`、`GET /api/islands/:id`
- 保持 `assets` 照舊服務 `index.html` — **前端一行都唔改**

**驗收**：`curl /api/world` 回傳 7 islands / 21 items / 12 flows，數量同 `src/01-data.js` 一致；`index.html` 仍然正常 render。

### Phase 2 — Durable Object + WebSocket 即時同步（2-3 天）
- 新增 `WorldRoom` DO（`storage: "sqlite"`），用 `ctx.acceptWebSocket()`（**唔係 `ws.accept()`**）
- Worker 加 `/ws` 路由：驗證 token → 轉發到 `env.WORLD_ROOM.getByName('main')`
- DO 內：broadcast mutation、presence 10Hz 節流、seq counter
- 前端新增 `src/09-net.js`（**新檔案，但要更新 `build.py` 嘅 `ORDER` 陣列**）：
  - WS connect + exponential backoff 重連
  - 收 `mutation` → 套用 → `STATE.dirty = true`
  - `POST /api/session` → 存 token
  - 唔好喺 `08-boot.js` 之前 require
- **前端改動要最小**：新模組只做「網絡 + 事件派發」，實際場景變更由 `07-ui.js` / `08-boot.js` 嘅 callback 處理

**驗收**：兩個瀏覽器視窗，一個加建築 → 另一個 1 秒內見到；關閉其中一個再重開 → 狀態一致（靠 `last_seq` 補洞）。

### Phase 3 — 使用者 mutation + 審計 + 反垃圾（1-2 天）
- `POST /api/mutations`（驗證、model 白名單、長度限制）
- Rate Limiting binding + DO 端全域 mutation budget
- Turnstile widget 接 `POST /api/session`
- `users` / `mutations` 表寫入
- 前端加「加建築」UI（放喺 island 卡入面 → 揀 archetype → 填名 → 提交）

**驗收**：送出非法 `model` 被 400 拒絕；同一 token 1 分鐘內第 6 次 mutation 被 429；`mutations` 表有審計記錄。

### Phase 4 — Cron 新聞 pipeline（2 天）
- KV `news-cache` namespace
- RSS fetch + parse（手寫 tiny parser，**唔准加 npm 依賴**）
- Tier 1 關鍵詞分類 + 重要性評分
- Tier 2 Workers AI（可選 feature flag）
- gating 規則（每日 ≤3、每次 ≤1、全域 ≤40、連續同主題跳過）
- 寫 D1 → 通知 DO 廣播 → 客戶端即時加新島
- **前端改動**：合併 server islands + 處理「外圈衛星島」位置（見 §6.5 + Risk 1）

**驗收**：手動觸發 cron → 新島出現喺所有連線中；第 4 座新島當日被拒（gating 生效）；`news_items` 有去重（同一 URL 只一條）。

### Phase 5 — 帳號 + 打磨（可選，2 天）
- `POST /api/session/claim`（匿名 → 具名 handle）
- 可選：Cloudflare Access / OpenAuth
- 貢獻排行榜
- `GET /api/mutations?since=` fallback endpoint

### Phase 6 — 部署穩固（0.5 天）
- 正式 custom domain（例如 `policy-islands.<domain>`），唔再用 `workers.dev` / 臨時帳戶
- `wrangler versions` + rollback 演練
- Cloudflare Access 只保護 `/api/*` 嘅管理端點（唔保護公開頁面）
- 監控：`wrangler tail` + Workers Logs / DO Data Studio（唯讀查 DO SQLite）

---

## 11. 三大技術風險 + 緩解

### 🔴 Risk 1 — 前端「外圈新島」會撞壞現有地形的硬編碼假設

**問題描述：**
現有 3D 場景有多個「魔法數」綁死喺 7 座島、環半徑 22。**以下全部係實測 `src/` 出嚟嘅真實常數**：

| 常數 | 值 | 位置 | 意義 |
|---|---|---|---|
| `ISL_R` | `22` | `src/01-data.js` | 6 座環島中心喺 r=22 嘅圓上 |
| `ISL_RAD` | `7.4` | `src/04-buildings.js:3` | 六角島自身半徑（hub = 7.9） |
| 環島外緣 | `22 + 7.4 = 29.4` | 推算 | 現有島群最外圈 |
| 城市盆地壓平 | `h -= (1 - smoothstep(28, 38, r)) * 5.0` | `src/03-terrain.js:16` | r<28 全壓落海平面，r=38 完全放開 |
| 環狀山起點 | `smoothstep(40, 55, r) * 13.0` | `src/03-terrain.js:10` | **r=40 開始有山** |
| 山帶外沿 | `1 - smoothstep(72, 94, r)` | `src/03-terrain.js:10` | r>94 山帶結束 |
| fbm 細節起動 | `smoothstep(32, 46, r)` | `src/03-terrain.js:12` | r=32 開始有起伏 |
| 鏡頭側壓低 | `camSide * smoothstep(20, 46, r) * 5.0` | `src/03-terrain.js:19` | +z 側地形下沉 |

**幾何衝突（實測計算）：**
- 現有島群外緣 r = **29.4**。
- 盆地放開 r = **38**，山帶起點 r = **40**。
- 一座新衛星島（半徑 7.4）要唔撞現有島，中心至少要 r > 29.4；要唔坐喺山腰，中心 + 7.4 最多到 ~34 → **中心安全區只有 r ≈ 30–34，闊度得 ~4 單位**。
- 4 單位闊嘅環，扣起每座新島自己佔 7.4 寬 → **最多只能塞得 1-2 座新島**，之後就一定撞山。

**連鎖後果：**
1. 新島坐喺 r=30-34 → 會坐喺「盆地放開 r=38」嘅過渡帶，地形唔再平，島嘅六角底座會懸空或半沉。
2. `src/05-walkers.js` Dijkstra 沿 `FLOWS` 行；新 flow 令路徑變長，可能穿過新島或山帶。
3. `src/06-select.js` CSS2D 標籤避讓只對 7 個島名 + 3 個 pin 調過；11-13 座島時會互相重疊。
4. `SPEC-v2.md` §1.1 嘅驗收（城市佔畫面 ≥ 22%、山帶 r≥38、天空 15-30%）會全部要重跑。

**緩解（按推薦次序）：**

1. **🥇 新島唔入 3D 主場景 → 改用 2D 地圖視圖（強烈推薦）**
   加一個圓形 SVG minimap / 平面圖 mode：7 座核心島 + 全部新聞島喺 2D 圖上可見、可點擊、可 tooltip；3D 主場景維持 7 座核心島 + 最多 1-2 座外圈島。
   - **好處**：零碰撞、零地形改動、零 CSS2D 改動、對應「政策地圖」隱喻、新島數量完全冇上限。
   - **代價**：新島唔會出現喺 3D 畫面（但需求只係「增加島嘅數量」，2D 圖已經滿足）。

2. **🥈 如果一定要入 3D：擴大地形常數**
   - 盆地壓平 → `smoothstep(28, 38)` 改成 `smoothstep(38, 52)`；山帶起點 → `smoothstep(52, 70)`；外沿 → `smoothstep(84, 104)`。
   - 新島中心 r = `38 + 8×n`（n=0,1,2…），可容納 ~4-5 座外圈島。
   - **代價**：改動 `src/03-terrain.js` 4 個 magic number → 必須重跑 SPEC §1.1 全部視覺驗收（相機距離、地平線、天空比例會全部變）。**呢個係最易做壞視覺嘅路徑。**

3. **🥉 3D 完全唔放新島，最簡單**
   新島只存在於 D1 + 2D 圖 + sidebar 清單。1 日內完成。

4. **不論邊條路，唔好改 `ISLANDS` / `ITEMS` / `FLOWS` 結構名稱**（`AGENTS.md` 規則 7）—— 用 `const ISLANDS = [...SEED, ...fromServer]` 嘅擴展模式，`ISL_POS` 計算要多處理「無 `ang` 但有 `radius`」嘅情況。

5. **新島唔好自動連 flow**（或者連 0-1 條 `kind='pending'`）。因為 flow 會改 Dijkstra 路徑 → 改 108 個 walker 嘅路線 → 改 walker 動畫。先觀察清楚先開。

6. **新島功能必須喺獨立 flag 後面**（`?news=1` 或 localStorage 開關），Phase 4 唔好影響預設體驗。`SPEC-v2.md` §0 嘅「已實測通過」清單要重新驗證。

**緩解成本**：方案 1 = 低（1 日，只加 UI）；方案 2 = 中（1-2 日 + 重跑視覺驗收）；方案 3 = 最低（0.5 日）。

---

### 🔴 Risk 2 — 免費計劃嘅 request / CPU 配額會喺第一次有真人用時即刻爆

**問題描述：**
Workers Free 計劃：100,000 requests/日、**10 ms CPU per request**。D1 rows written 100,000/日。

- 10 ms CPU **做唔到** parse 一個 447 KB 嘅 `info.gov.hk` RSS（XML parse 至少 50-200 ms）
- WebSocket 連接本身算 1 個 request；20 人同時開 = 20
- **但 `run_worker_first` 嘅 API 路由每個 request 都計**；如果將來前端 fetch 大量資源，全部撞 Worker → 30 秒內就 429
- D1 每次 mutation 寫 3-6 rows（含索引雙計）→ 免費 100,000 rows/日 ≈ 20,000 mutations/日，聽落好多，但**如果 news pipeline 每次寫 `news_items`（每篇 1 row + URL unique index 1 row = 2 rows）+ island + items + flows + mutation log = ~10 rows/mutation**，2,000 次 mutation 就爆

**緩解：**
1. **第一日就上 Workers Paid（$5）**。成本估算（§8.3）顯示 $5 完全覆蓋。呢個唔係「優化」，係「前提條件」。
2. 開 `observability`（已經喺 `wrangler.jsonc` 度開咗）→ 用 Workers Logs 睇實際 CPU 使用率。
3. **結構化 storage 減少 writes**：batch 多個 statement 成 1 個 request；避免 `CREATE INDEX` 過多（每個 index 都係一次額外 write）。
4. 新聞 pipeline 寫入前先檢查 `island_generation_log` 避免重複。
5. 加 usage alert（Cloudflare dashboard → Notifications）。
6. **設計上唔好讓靜態資源經過 Worker**：`assets.directory` + 唔好設定過寬嘅 `run_worker_first`（只限 `/api/*` 同 `/ws`）。Worker docs 明確講 static asset 請求免費且無限。

**殘餘風險**：如果用戶數爆到 1000+，DO requests（1M/月包含）會唔夠 → 需要 $0.15/M。呢個金額仍然細，唔需要過度設計。

---

### 🟡 Risk 3 — 單一 DO 房間 = 單點故障 + 序列化瓶頸

**問題描述：**
`WorldRoom` 係全 app 嘅**單一序列點**。所有 mutation 都經過佢。

1. **單點**：DO 全域唯一，唔會有兩個實例。但佢係「單執行緒」—— 一個慢操作（例如同步寫入一堆 D1）會 block 全部用戶嘅 mutation。
2. **1000 req/s 軟上限**：DO 單實例約 1,000 req/s。對呢個 app 綽綽有餘，但係要知。
3. **Hibernation 的反效果**：DO 每 10 秒 hibernation → 下次 event 會重跑 constructor。**如果 constructor 太慢（讀 D1 / 初始化大 state），每次 wake 都有延遲**。文件明確建議「Minimize work in the constructor when using hibernation」。
4. **DO 部署 / runtime 更新**會重啟 constructor（文件「Shutdown behavior」）。連線會斷 → 客戶端必須有重連（§4.2 已設計）。
5. **D1 寫入在 DO 裡面做**：DO → D1 係網絡來回（~30-80 ms）。如果每次 mutation 都同步等 D1 寫完，mutation 吞吐會被拖慢。**必須用 `ctx.waitUntil()` 做異步寫入 + 廣播先、寫入後** → 但咁樣就出現「廣播咗但寫入失敗」嘅不一致窗口。

**緩解：**
1. **Constructor 只做最輕量嘅 init**（讀 `world_meta` 嘅 seq counter 一次，或者甚至快取喺 module-level 嘅 Map）。唔好喺 constructor 讀 D1、唔好建立大型 state。
2. **兩階段提交避免不一致**：
   - 同步：validation + 分配 `seq`（in-memory counter，持久化喺 `ctx.storage.sql`，每 N 次或每秒 flush）
   - 異步：`ctx.waitUntil(d1.batch([...]))` 寫權威
   - 廣播：**喺 D1 寫入成功之後**先廣播（`await` D1），唔好 fire-and-forget —— 寧願慢 50 ms 都唔好畀用戶見到「加咗但其實失敗」
   - 若 D1 寫入失敗 → 唔廣播，回 `error` 俾發起者（用戶見到自己嘅建築冇出現，其他人也冇見到 → 一致）
3. **唔好喺 DO 裡面做重操作**：AI 分類、新聞 fetch 一律放喺 Cron Worker，唔好經過 DO。
4. **Payload 大小有上限**：每次 broadcast 淨係送 mutation 差異（~200 bytes），唔送全場景。單條 WebSocket message 上限 32 MiB，但 Keep 一個細 payload 遠好過撞上限。
5. **未來如果要多房間**：`idFromName(roomId)` 天然支援 —— 但**唔好**現在就開。要開的話，每個房間 = 一個 DO + 一個 D1 database（因為 DO 嘅 SQLite 係私有的，跨房間 join 要自己 fan-out）。呢個係「按需水平擴展」嘅正確形態，而唔係 premature。
6. **客戶端重連必須容錯**（runtime 更新會斷 WS）。已經喺 §4.2 設計。

**殘餘風險**：中低。若真係需要，我可以喺後續加「多房間 + D1 主資料 + DO 只做即時層」嘅拆法，唔影響 D1 schema。

---

## 12. 附錄 A：`wrangler.jsonc` 目標形態（已按本機 wrangler schema 驗證）

本機 `wrangler` 嘅 `config-schema.json`（`/opt/data/home/.local/lib/node_modules/wrangler/config-schema.json`）已確認以下 key 全部存在：`exports` / `ratelimits` / `durable_objects` / `d1_databases` / `kv_namespaces` / `triggers` / `assets` / `ai` / `queues` / `r2_buckets` / `workflows` / `observability` / `vars`。

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "policy-islands",
  "main": "worker/api.js",              // ← 而家無 `main`，默认用 worker.js
  "compatibility_date": "2026-10-19",   // 保留；nodejs_compat 由 2026-08-04 起預設開啟
  "observability": { "enabled": true },

  // 靜態前端（取代 worker.js 內嵌 HTML）
  "assets": {
    "directory": "./cf-dist",           // build.py 輸出目標
    "binding": "ASSETS",
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "none",
    "run_worker_first": ["/api/*", "/ws"]   // 只呢啲路徑先經 Worker
  },

  // Durable Object（單一世界房間）
  "durable_objects": {
    "bindings": [{ "name": "WORLD_ROOM", "class_name": "WorldRoom" }]
  },
  "exports": {
    "WorldRoom": { "type": "durable-object", "storage": "sqlite" }
    // ⚠️ `exports` 同 `migrations` 互斥，唔可以兩個都寫
  },

  // D1（權威資料）
  "d1_databases": [{
    "binding": "DB",
    "database_name": "policy-islands-main",
    "database_id": "<uuid>",
    "migrations_dir": "migrations"
  }],

  // KV（新聞 cache）
  "kv_namespaces": [{ "binding": "NEWS_CACHE", "id": "<namespace-id>" }],

  // 排程
  "triggers": { "crons": ["0 */2 * * *"] },

  // 反濫用（period 只可以是 10 或 60）
  "ratelimits": [{
    "name": "MUTATION_LIMIT",
    "namespace_id": "1001",
    "simple": { "limit": 5, "period": 60 }
  }],

  // 可選：Workers AI
  // "ai": { "binding": "AI" },
  // 可選：R2
  // "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "policy-islands-media" }]
}
```

**注意：** `exports` 取代舊嘅 `migrations` 陣列（`migrations` 依然支援，但**同一個 Worker 只能二選一**）。DO class 嘅 SQL 用 `ctx.storage.sql`，而 `storage: "sqlite"` 係免費計劃唯一支援嘅 backend。

---

## 13. 附錄 B：立即可做嘅下一步

1. `git init && git add -A && git commit`（喺 `/opt/data/policy-islands`）— 而家完全冇版本控制
2. 清理磁碟（98% 已用，剩 2.5 GB）
3. 上 Workers Paid（$5/月）
4. `wrangler d1 create policy-islands-main --location=apac`
5. 寫 `migrations/0001_init.sql`（§2.1）
6. 寫 seed 產生器（Node script 讀 `src/01-data.js` → SQL）
7. 改 `wrangler.jsonc`（附錄 A）
8. **改 `build.py` 嘅 `ORDER` 加入 `09-net.js`**（如果做 Phase 2）
9. `python3 build.py` 確認 `ASSEMBLED ... | 2 JS blocks OK`

---

## 14. 引用來源

所有數字都來自 Cloudflare 官方文件（2026-10-23 抓取）：

- `developers.cloudflare.com/workers/platform/limits/` (2026-10-12)
- `developers.cloudflare.com/workers/platform/pricing/` (2026-10-02)
- `developers.cloudflare.com/workers/runtime-apis/nodejs/` (2026-08-12) — `node:sqlite` 為 non-functional stub
- `developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/` (2026-10-21)
- `developers.cloudflare.com/workers/configuration/cron-triggers/` (2026-10-17)
- `developers.cloudflare.com/workers/configuration/compatibility-flags/` — `enable_nodejs_sqlite_module` (2026-01-29)
- `developers.cloudflare.com/workers/static-assets/billing-and-limitations/` (2026-04-23)
- `developers.cloudflare.com/d1/platform/limits/` (2026-04-21)
- `developers.cloudflare.com/d1/platform/pricing/` (2026-04-21)
- `developers.cloudflare.com/d1/best-practices/read-replication/` (2026-08-10)
- `developers.cloudflare.com/d1/configuration/data-location/` — location hints `apac`（實測 wrangler 亦只有 `weur/eeur/apac/oc/wnam/enam`）
- `developers.cloudflare.com/durable-objects/platform/limits/` (2026-06-01)
- `developers.cloudflare.com/durable-objects/platform/pricing/` (2026-10-18)
- `developers.cloudflare.com/durable-objects/best-practices/websockets/` (2026-09-30)
- `developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/` (2026-10-15)
- `developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/` — `exports` / `storage: "sqlite"`
- `developers.cloudflare.com/durable-objects/api/storage-api` — PITR 30 日
- `developers.cloudflare.com/workers/platform/storage-options/` (2026-10-06) — D1 vs DO SQL 對比、KV 做 session storage
- `developers.cloudflare.com/kv/platform/limits/` (2026-10-08)
- `developers.cloudflare.com/queues/platform/limits/` + pricing (2026-04-21)
- `developers.cloudflare.com/turnstile/` (2026-08-14) + `/turnstile/plans/`
- `developers.cloudflare.com/workers-ai/platform/pricing/` (2026-10-20)
- `developers.cloudflare.com/hyperdrive/platform/pricing/` (2026-06-18)
- `developers.cloudflare.com/r2/pricing/` (2026-10-01)
- `developers.cloudflare.com/browser-run/pricing/` (2026-04-21)
- `github.com/cloudflare/workerd/issues/6878` — `node:sqlite` `DatabaseSync` 未 constructible

**實測驗證（本機）**：RTHK zh RSS (`c_expressnews_clocal.xml` / `cfinance` / `cinternational`) 全部 HTTP 200；`info.gov.hk/gia/rss/general_zh.xml` 200 (352 KB)；`general_en.xml` 200 (447 KB)；`c_expressnews_cgreaterchina.xml` 302 → HTML（唔用）；`info.gov.hk/gia/rss/general_tc.xml` 404（唔用）。
