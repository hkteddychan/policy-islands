# TASK-3 — Phase 1.5: D1 → Durable Object SQLite 遷移（因為 token 冇 D1 權限）

## 背景 / 為乜改

Cloudflare API token（`cfut_Wpg...`）**有** Workers Scripts / KV / Pages / Durable Objects / Queues 權限，
但 **冇 D1 權限**（`GET /accounts/{ACC}/d1/database` → 401 Authentication error）。

已用真實 API 實測確認，唔係猜：

| Product | Token 權限 |
|---|---|
| Workers Scripts | ✅ 200 |
| Workers KV | ✅ 200 (`/storage/kv/namespaces`) |
| Pages Projects | ✅ 200 |
| Durable Objects namespaces | ✅ 200 |
| Queues | ✅ 200 |
| **D1** | ❌ **401** |
| R2 | ❌ 403（未 enable） |

**所以：持久 SQL 改用 Durable Object 嘅 `ctx.storage.sql`。**
DO 嘅 SQLite 係同一個 `node:sqlite` 風格 API（`ctx.storage.sql.exec()`），
可以用同一份 schema SQL，唔使改資料模型。

## 現況（Phase 1 已完成，已驗收）

- `migrations/0001_init.sql` — 完整 schema（islands/items/flows/users/sessions/mutations/news_items/world_meta）
- `scripts/gen-seed.mjs` — 由 `src/01-data.js` 自動生成 `migrations/0002_seed.sql`
- `src/worker/index.js` — 248 行，只讀 API，D1 版
- `wrangler.jsonc` — `main: src/worker/index.js`, `assets.directory: "dist"`, `d1_databases` binding（placeholder）
- `scripts/verify-phase1.mjs` — 26 個 PASS
- `python3 build.py` → `DIST 133623 bytes -> dist/index.html` + `WORKER node --check OK`
- **前端 `src/00-imports.js`~`src/08-boot.js` 零改動**（`git diff --stat src/` 係空）

## 你要交付嘅嘢

### 1. `src/worker/world-room.js` — Durable Object
- `export class WorldRoom`（`state = { initialized: false }`）
- `storage: "sqlite"` 綁定（喺 `wrangler.jsonc` 加 `durable_objects.bindings`）
- **初始化**：constructor 只做最輕量嘢（AGENTS/ARCHITECTURE.md Risk 3 要求）。
  第一次有人 request 嘅時候，用 `ctx.blockConcurrencyWhile()` 跑：
  - 讀 `migrations/0001_init.sql`（用 `import` 讀檔，唔好 fs）→ `ctx.storage.sql.exec()`
  - 讀 `migrations/0002_seed.sql`（如果存在）→ exec
  - `ctx.storage.sql.exec("INSERT OR IGNORE INTO world_meta ...")`
- **方法**（每個都做 `ensureInit(ctx)`）：
  - `getWorld()` → `{islands, items, flows, seq}`
  - `getIsland(id)`
  - `getMutations(since)`
- SQL 要用 `ctx.storage.sql.exec(sql, ...params)` — 參數化
- 注意：DO SQLite API 用 `?` 佔位符同 D1 一樣，但 `exec()` 只返 `{results}` 或者要 `stmt.all()`
  → **你要自己驗證實際 API 形狀**，唔好照抄 D1 嘅 `stmt.all()`

### 2. `src/worker/index.js` — 改成 DO 版
- 保留所有 HTTP 路由同回應格式（**`/api/world` 回傳格式要同 verify script 一致**）
- 內部改成調用 `env.WORLD_ROOM.getByName('main')` → `stub.fetch()` 或者直接 `stub.getWorld()`
  - **推薦直接 RPC**：DO class 定義 public method，然後 `stub.getWorld()`（Workers RPC，乾淨）
- 冇 DO binding 時 → 503 + 清晰 message（保留現有行為）
- 保留 `handleRequest` export（verify script 依賴）
- **保留 D1 版做 fallback**？唔好 — 直接切換，簡單啲。但要在檔頭註明改動原因

### 3. `wrangler.jsonc`
```jsonc
{
  "name": "policy-islands",
  "main": "src/worker/index.js",
  "compatibility_date": "2026-10-19",
  "observability": { "enabled": true },
  "assets": { "directory": "dist", "binding": "ASSETS" },
  "durable_objects": {
    "bindings": [
      { "name": "WORLD_ROOM", "class_name": "WorldRoom" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["WorldRoom"] }
  ]
}
```
- **移除** `d1_databases` binding（D1 冇權限，留低會令 deploy fail）
- 保留 `migrations_dir` 相關喺 `d1_databases`？移除 D1 block 就冇呢個 field

### 4. `scripts/verify-phase1.mjs` — 改成測 DO 路徑
- 現時用 `node:sqlite` 測 D1 SQL。改成：
  - 仍然用 `node:sqlite` 驗 schema + seed SQL 正確（呢部分唔使改）
  - **新增**：mock 一個 DO stub（`{ getWorld: async () => ({...}) }`），測 `handleRequest` 經 DO 路徑
  - 測 `ensureInit` 嘅冇-DO 情況 → 503
- 保持 ≥ 26 個 PASS

### 5. `docs/PHASE1.md` — 更新
- 解釋點解用 DO 而唔用 D1（token 權限實測結果）
- 部署步驟：`wrangler deploy`（唔需要 `d1 create`）
- 驗收 curl

## 硬性規則

1. 零新依賴、零 npm install
2. **前端 `src/00-imports.js`~`src/08-boot.js` 一個字都唔准改**
3. 唔准 `git reset --hard` / `git push`
4. 唔好 commit
5. 每個新 JS 檔 `node --check` 過
6. DO 嘅 SQL API 形狀你要**實際驗證**（可以寫個小 script 用 node:sqlite 對照，或查 wrangler 類型定義），
   唔好淨係照抄 D1 API 然後 claim 對

## 完成標準

- `node scripts/verify-phase1.mjs` ≥ 26 PASS、0 FAIL
- `python3 build.py` 成功，輸出格式不變（`DIST <n> bytes -> dist/index.html` + `WORKER node --check OK`）
- `src/worker/index.js` + `src/worker/world-room.js` `node --check` 通過
- `git diff --stat src/` 依然係空
- `wrangler deploy --dry-run` 成功（用 `CLOUDFLARE_API_TOKEN` env，token 喺 `/opt/data/.config/cloudflare/.env`：
  `export CLOUDFLARE_API_TOKEN="$(grep -o 'cfut_[A-Za-z0-9]*' /opt/data/.config/cloudflare/.env)"`）

## 交付

列出每個檔案做咗咩 + 驗證輸出。唔好 commit。
