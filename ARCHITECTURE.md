# 政策島 Policy Islands — 多玩家 + 資料庫 架構決策 (Phase 1)

> 決策日期：2026-10-23 · 來源：`research/backend-arch.md`（844 行，Cloudflare 官方文件引用）
> 狀態：**Phase 1 實作中**，前端單檔 app 全程保持可用

---

## 用戶需求 → 設計對應

| 用戶原話 | 設計 |
|---|---|
| 「multiple person interactive games with database」 | Durable Object `WorldRoom`（單房間 WebSocket）+ D1 權威持久層 |
| 「user could add element and then reflect in the game」 | `POST /api/mutations` → DO 分配 seq → D1 寫入 → DO 廣播 → 所有客戶端即時加建築 |
| 「according to public news the island number will be increased」 | Cron Trigger 每 2 小時抓 RSS → 關鍵詞分類器 → gating → 自動生成新島 → 廣播 |
| 「it may need frontend and backend」 | Workers Static Assets（前端）+ Worker API（後端）+ D1 + DO + KV + Cron |

---

## 推薦棧（決定咗，唔再搖）

```
┌─ 前端（不變）──────────────────────────────┐
│ index.html 單檔 133KB · Three.js r160       │
│ src/01-data.js  → 改成 SEED + server merge │
│ src/09-net.js  → 新增（WS + API client）    │
└──────────────────┬──────────────────────────┘
                   │ HTTPS + WebSocket
┌─ Cloudflare Worker（原生 JS，零依賴）──────┐
│ /            → Static Assets（免費無限）   │
│ /api/world   → 讀 D1                        │
│ /api/session → 匿名 token                   │
│ /api/mutations → 驗證 + 限流 + 寫 D1        │
│ /ws          → 轉發到 DO                     │
│ scheduled    → Cron: 新聞 pipeline           │
└──────┬──────────────────┬───────────────────┘
       │                  │
  ┌────▼─────┐      ┌─────▼──────────┐
  │  D1      │      │ Durable Object │
  │ (權威)   │      │  WorldRoom     │
  │ islands  │      │ · WebSocket    │
  │ items    │      │ · seq counter  │
  │ flows    │      │ · broadcast    │
  │ users    │      └────────────────┘
  │ mutations│
  │ news     │      ┌────────────────┐
  └──────────┘      │ KV news-cache  │
                     └────────────────┘
```

**D1 location**：`apac`（香港最近）
**計劃**：Workers **Paid $5/月**（免費層 10ms CPU 唔夠做 RSS parse）

---

## 關鍵約束（實測確認）

| 事實 | 值 | 影響 |
|---|---|---|
| `node:sqlite` 喺 Workers | **non-functional stub**（workerd #6878） | 持久 SQL 只有 D1 或 DO `ctx.storage.sql` |
| 現有場景硬編碼 | `ISL_R=22`, 盆地 `r<32`, 山帶 `r≥38` | **新島唔可以直接塞入主環**（見下） |
| 磁碟 | 98% 已用（剩 2.5G） | 唔好喺本機 cache 大量新聞 |
| Git | Phase 0 已 `git init` + commit `c87ab58` | 有 rollback 手段 |
| CDN | jsdelivr → unpkg fallback 已實作 | 唔加新 CDN 依賴 |

---

## 🔴 Risk 1 處理：新島唔塞入 3D 主環

**問題**：`src/01-data.js` 用 `ISL_R=22` 算位置，`src/03-terrain.js` 盆地壓平到 `r<32`、山帶喺 `r≥38`。
新島放喺 `r=32–37` 會撞山、令盆地失效、改變 108 個 walker 路徑、CSS2D 標籤重疊。

**解法（Phase 4 執行，Phase 1 先唔理）**：
1. 新島用 **2D minimap 視圖** 為主（圓形 SVG 平面圖）— 風險最低，最符合「政策地圖」隱喻
2. 3D 場景最多容許 **2–3 座外圈衛星島**（`r=32–37`），並**同步改地形常數**（盆地→r<38，山帶→r≥44）
3. 全部喺 `?news=1` flag 後面，唔影響預設體驗
4. 新島初期**唔自動生成 flow**（孤立觀察）

---

## 資料模型（D1）

見 `research/backend-arch.md` §2.1 完整 DDL。摘要：

- `islands` — 7 seed + user/news 新增；`origin` = seed|user|news
- `items` — 21 seed + 用戶新增建築；`model` = archetype 白名單
- `flows` — 12 seed + 新增協作線
- `users` — 匿名 token（SHA-256 hash 儲存，唔存明文）
- `mutations` — 不可變審計日誌 + 全域 `seq`（同步用）
- `news_items` — 去重後新聞（`id` = sha256(url)[:16]）

---

## 分階段計劃

| Phase | 內容 | 驗收 |
|---|---|---|
| **0** ✅ | git init + commit、磁碟清理、CF token | `git log` 有 commit |
| **1** ← 現在 | D1 + migrations + seed 產生器 + `GET /api/world` | `curl /api/world` 回 7/21/12；前端一行唔改仍然 work |
| **2** | DO `WorldRoom` + WebSocket + `src/09-net.js` | 兩窗互見 mutation |
| **3** | `POST /api/mutations` + 匿名 session + 限流 + 審計 + 加建築 UI | 非法 model 400；第 6 次 429 |
| **4** | Cron 新聞 pipeline + 分類器 + gating + 新島 | 手動觸發 → 新島出現；第 4 座被拒 |
| **5** | 具名帳號、貢獻榜、`?since=` fallback | 可選 |
| **6** | custom domain、rollback 演練、監控 | 可選 |

---

## Phase 1 執行細則

**要做**：
- `wrangler.jsonc`：加 `d1_databases` binding、`assets.directory` 指向 build 產物
- `migrations/0001_init.sql`：完整 schema
- `scripts/gen-seed.mjs`：讀 `src/01-data.js` → 抽 ISLANDS/ITEMS/FLOWS → 生成 `migrations/0002_seed.sql`（**自動生成，唔手抄**）
- `src/worker/*.js`（Worker 入口）：`/api/health`、`/api/world`、`/api/islands/:id`
- `build.py`：加 worker bundle 步驟（Worker 同前端分開 build）
- **前端唔改**（`src/01-data.js` 保持硬編碼做 fallback）

**唔准**：
- ❌ 加 npm 依賴 / 打包工具（AGENTS.md rule 5）
- ❌ 改 `ISLANDS`/`ITEMS`/`FLOWS` 結構名稱（rule 7）
- ❌ 喺本機跑 `git commit` 以外嘅 git 操作

**驗收腳本**：`scripts/verify-phase1.mjs` → 輸出 PASS/FAIL

---

## 待決事項（需要用戶）

1. **CF API token** — 我哋機器冇存過任何 CF 憑證。冇 token 做唔到 `wrangler d1 create` / 真實部署
   - 替代：`wrangler deploy --temporary` 只能測 Worker，**D1 唔支援 temporary**（D1 要真帳戶）
2. **Workers Paid $5/月** — 免費層 10ms CPU 做唔到 RSS parse。純 Phase 1（只讀 API）免費夠用
3. **新聞源** — 實測可用：`info.gov.hk/gia/rss/general_zh.xml`（100 條）、`rthk9.rthk.hk/.../c_expressnews_clocal.xml`（20 條）。關鍵詞分類器實測 **78% 覆蓋率**（未分類 22% 係治安/康樂類，合理）
