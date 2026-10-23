# Phase 1 — 資料層 + 只讀 API（已完成並部署）

## 線上位置

| | |
|---|---|
| **Worker + DO** | https://policy-islands.teddy-spot.workers.dev |
| API | `/api/health` · `/api/world` · `/api/islands/:id` · `/api/mutations?since=N` |
| GitHub Pages（前端） | https://hkteddychan.github.io/policy-islands/ |
| DO class | `WorldRoom`（`src/worker/world-room.js`），`storage: sqlite` |
| 版本 | `1.1.0-phase1.5` |

## 點解用 Durable Object 而唔用 D1

本帳戶嘅 Cloudflare API token 權限（實測，非推測）：

| Product | 權限 |
|---|---|
| Workers Scripts | ✅ 200 |
| Workers KV | ✅ 200 |
| Pages Projects | ✅ 200 |
| Durable Objects namespaces | ✅ 200 |
| Queues | ✅ 200 |
| **D1** | ❌ **401 Authentication error** |
| R2 | ❌ 403（未 enable） |

D1 冇 scope，所以持久 SQL 改用 **Durable Object 嘅 `ctx.storage.sql`**。
Worker runtime 上唯一可用嘅關聯式 SQL API（`node:sqlite` 喺 Workers 只係 non-functional stub，workerd #6878）。

**資料模型完全冇變** — 同一份 `migrations/0001_init.sql`。

## 架構

```
Browser ──HTTPS──> Worker (policy-islands)
                    ├─ /api/*        → Worker API
                    ├─ /             → static assets (dist/)
                    └─ /api/world ──> WorldRoom DO (SQLite)
                                        ├─ ctx.storage.sql  (持久)
                                        └─ ASSETS fetch('seed.sql') (一次性初始化)
```

## 檔案

| 檔案 | 用途 |
|---|---|
| `migrations/0001_init.sql` | schema（8 張表 + 索引） |
| `migrations/0002_seed.sql` | 自動生成嘅 seed（7/21/12），可重複執行 |
| `scripts/gen-seed.mjs` | 由 `src/01-data.js` 抽 seed → SQL（唔手抄） |
| `src/worker/index.js` | Worker 入口 + 路由 + CORS |
| `src/worker/world-room.js` | Durable Object：schema、seed、查詢 |
| `scripts/verify-phase1.mjs` | 36 個本機驗收（唔使 Cloudflare） |
| `build.py` | 組裝 index.html + dist/ + worker syntax gate |

## 驗收（實測）

```
$ node scripts/verify-phase1.mjs
36 passed, 0 failed
PASS phase 1 verification

$ curl https://policy-islands.teddy-spot.workers.dev/api/health
{"ok":true,"version":"1.1.0-phase1.5","backend":"durable-object","world":"ready"}

$ curl .../api/world
{"islands":7,"items":21,"flows":12,"seq":0, ...}
```

## 部署步驟（要 CF token）

```bash
export CLOUDFLARE_API_TOKEN="cfut_..."
export PATH="/opt/data/home/.local/bin:$PATH"

cd /opt/data/policy-islands
python3 build.py                      # 組裝 + syntax gate + dist/
node scripts/gen-seed.mjs             # 重新生成 seed（改咗 src/01-data.js 就跑）
node scripts/verify-phase1.mjs        # 本機驗收
wrangler deploy                       # 真實部署
```

Token 已存喺 `/opt/data/.config/cloudflare/.env`（mode 0600）：
```bash
export CLOUDFLARE_API_TOKEN="$(grep -o 'cfut_[A-Za-z0-9]*' /opt/data/.config/cloudflare/.env)"
```

## 踩過嘅坑（唔好再犯）

1. **DO class 唔支援 RPC** — 傳統 constructor 寫法（唔 `extends DurableObject`）→ 必須用 `stub.fetch()` 內部 HTTP，唔可以 `stub.getWorld()`
2. **`cursor.one()` 零結果會 throw** — "Expected exactly one result from SQL query" → 一律用 `cursor.toArray()[0]`
3. **`sql.exec(sql, ...params)`** 係 variadic 參數，唔係 D1 嘅 `.bind()`
4. **assets 要 binding 名** — `wrangler.jsonc` 加 `"assets": { "directory": "dist", "binding": "ASSETS" }`，然後 `env.ASSETS.fetch()`
5. **D1 冇權限唔代表唔可以做** — DO SQLite 係同級替代方案

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | `{ok, version, backend, world: "ready" \| "missing" \| "error"}` |
| `GET` | `/api/world` | All live islands/items/flows + current `seq` |
| `GET` | `/api/islands/:id` | One island + its items + related flows |
| `GET` | `/api/mutations?since=N` | Mutations with `seq > N` (for Phase 2/3) |
| `OPTIONS` | any `/api/*` | CORS preflight (`Access-Control-Allow-Origin: *`) |

All data responses are JSON. Soft-deleted rows (`deleted_at NOT NULL`) are
excluded automatically. Missing backend → HTTP 503 with `{ "error": "..." }`;
the Worker never crashes and never returns a stack trace.

## 下一步（Phase 2）

- [ ] `src/09-net.js` — 前端 WS client（要更新 `build.py` 嘅 `ORDER`）
- [ ] DO 加 WebSocket（`ctx.acceptWebSocket()` — 唔係 `ws.accept()`）
- [ ] `POST /api/session` — 匿名 token
- [ ] `POST /api/mutations` — 加建築 + 限流 + 審計
- [ ] 前端「加建築」UI

⚠️ **Risk 1（外圈新島撞地形）**：現有 `ISL_R=22`、盆地 `r<32`、山帶 `r≥38` 全部硬編碼。
新島唔可以直接塞入主環 — 詳見 `ARCHITECTURE.md`。
