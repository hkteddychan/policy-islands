# TASK-2 — Phase 1: D1 資料層 + 只讀 API（Cloudflare Worker）

你係一個能幹嘅 coding agent。專案喺 `/opt/data/policy-islands`。

## 背景

「政策島 Policy Islands」係一個單檔 Three.js r160 3D app（政策協作可視化）。
而家要升級做多人 + 資料庫版本。**完整架構見 `/opt/data/policy-islands/ARCHITECTURE.md`**，
research 見 `/opt/data/policy-islands/research/backend-arch.md`（844 行，§2.1 有完整 DDL）。

**Phase 1 目標**：加一個 Cloudflare Worker 後端，提供只讀 API + D1 資料庫。
**前端一行都唔改** —— 現有 `index.html` 必須繼續正常運作。

## 現況（實測，唔好假設）

- `build.py` 組裝 `src/*.js` → `index.html`（133KB）。`src/` 順序喺 `build.py` 嘅 `ORDER` 陣列
- `src/01-data.js` 有 `ISLANDS`(7) / `ITEMS`(21) / `FLOWS`(12) 硬編碼
- `wrangler.jsonc` 現時：`name: policy-islands`, `compatibility_date: 2026-10-19`, `assets.directory: "."`
- **本機冇 Cloudflare 帳戶憑證** → 你 **冇權限** 執行 `wrangler d1 create` / 真實 deploy
- Node v26.5.1，Python 3.13.5，**冇 npm 依賴可以用**（AGENTS.md rule 5 禁止加依賴）
- 磁碟 98% 滿（剩 2.5G）→ 唔好寫大檔案
- Git repo 已 init，baseline commit `c87ab58` → **你可以 commit，但唔准 force push / reset**

## 你要交付嘅嘢

### 1. `migrations/0001_init.sql`
完整 schema（照 research §2.1，但你可以優化）：
- `islands`, `items`, `flows`, `users`, `sessions`, `mutations`, `news_items`, `world_meta`
- 每個 `id` 欄位用 TEXT PRIMARY KEY
- 軟刪除用 `deleted_at INTEGER`（NULL = alive）
- 適當索引（唔好過多，每個 index 都係額外 D1 write 成本）
- `mutations.seq` 做全域單調遞增序號（同步用）

### 2. `scripts/gen-seed.mjs`
**自動**由 `src/01-data.js` 抽出 seed，生成 `migrations/0002_seed.sql`。
- 關鍵：`src/01-data.js` 係 ES module（`export const ISLANDS = ...`），要用動態 `import()` 讀，唔好 regex 亂扒
- 輸出 INSERT 陳述句，值全部正確 escape（單引號、換行）
- **必須可重複執行**（`INSERT OR REPLACE`）
- 印出統計：islands/items/flows 各幾多筆，同 `src/01-data.js` 對得上

### 3. `src/worker/index.js`
Worker 入口（原生 JS，零依賴）：
- `GET /api/health` → `{ok:true, version, d1:"ready"|"missing"}`
- `GET /api/world` → `{islands:[], items:[], flows:[], seq}`，從 D1 讀（`deleted_at IS NULL`）
- `GET /api/islands/:id` → 單島 + 佢嘅 items + 相關 flows
- `GET /api/mutations?since=N` → 之後嘅 mutation（Phase 2/3 用）
- CORS：`Access-Control-Allow-Origin: *`，支援 `OPTIONS` preflight
- 冇 D1 binding 時唔好 crash → 返 503 + 清晰 message
- 錯誤要 `try/catch` 包住，返 JSON `{error:"..."}` 唔好漏 stack 出嚟

### 4. `wrangler.jsonc`
- 加 `main: "src/worker/index.js"`
- `assets.directory` 指向 build 產物（**唔好**用 `"."` — 會 upload 晒成個 project）
- 加 `d1_databases` binding（database_name `policy-islands-main`, binding `DB`, placeholder database_id — 因為我哋未 create 真 DB）
- 保持 `observability.enabled: true`

### 5. `build.py` 增量
- 組裝完 `index.html` 之後，額外生成 `dist/` 目錄（= Worker 嘅 static assets 來源：`index.html` + 任何需要嘅靜態檔）
- **唔好**破壞現有 `python3 build.py` 行為（仍然要印 `ASSEMBLED <n> bytes | 2 JS blocks OK`）
- 加 `node --check` 驗證 worker 入口

### 6. `scripts/verify-phase1.mjs`
本地驗證（**唔需要 Cloudflare**）：
- 用 `node:sqlite`（Node 26 內建）起一個 in-memory DB
- 執行 `migrations/0001_init.sql`
- 執行 `scripts/gen-seed.mjs` 生成嘅 seed SQL
- 執行 Phase 1 嘅查詢 SQL，assert：7 islands / 21 items / 12 flows
- 跑 worker handler 邏輯（直接 import handler function，用 mock D1 binding）
- 輸出 PASS/FAIL 行

### 7. `docs/PHASE1.md`
部署步驟（需要 token 先做得到）：
- `wrangler d1 create policy-islands-main --location=apac`
- 把真 database_id 填入 `wrangler.jsonc`
- `wrangler d1 migrations apply policy-islands-main --remote`
- `wrangler deploy`
- curl 驗收指令

## 硬性規則

1. **零新依賴** — 純 Node stdlib + Cloudflare Workers runtime API。唔准 `npm install` 任何嘢
2. **唔准改 `src/01-data.js` 嘅 `ISLANDS`/`ITEMS`/`FLOWS` 結構**（前端一律唔改）
3. **唔准改 `src/00-imports.js` 到 `src/08-boot.js`** 任何一個（前端一律唔改）
4. 唔准 `git reset --hard` / `git push` / 刪 `backup/` 目錄
5. 每個新 JS 檔都要 `node --check` 過
6. 磁碟使用保持喺 +5MB 以內

## 完成標準

- `python3 build.py` 仍然成功，輸出格式不變
- `node scripts/verify-phase1.mjs` 全部 PASS
- `node scripts/gen-seed.mjs` 產出嘅 SQL 執行後，DB 有 7/21/12 筆
- `src/worker/index.js` `node --check` 通過
- 現有 `index.html`（前端）**一個字都冇改**（用 `git diff --stat` 證明：只新增檔案 + 改 build.py / wrangler.jsonc）

## 交付

完成後用 `git status` + `git diff --stat` 總結改動，並列出每個檔案做咗咩。
唔好 commit（我會 review 完先 commit）。
