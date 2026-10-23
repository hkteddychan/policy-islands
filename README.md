# 政策島 Policy Islands

一個 3D「政策島」城市可視化：六座政策島 + 一座中央市政廳，每島代表一個政策主題，
島上有細項建築（小屋、市政廳、教室、診所…），小人沿「協作線」行走搬運物品，
反映政策之間的協作關係。附日夜循環、雙語介面、手機版。

![Policy Islands](https://img.shields.io/badge/three.js-r160-blue) ![lang](https://img.shields.io/badge/i18n-繁中%2FEnglish-green)

---

## 線上版本（兩個都上咗，內容完全一樣）

| 平台 | 網址 | 備註 |
|---|---|---|
| **GitHub Pages** | https://hkteddychan.github.io/policy-islands/ | 永久、免費、已驗證 |
| **Cloudflare Worker** | https://policy-islands.typhoon-friction.workers.dev/ | **臨時帳戶**（`--temporary`），隨時可能被回收；正式部署需 CF API token |

兩邊都係同一個 `index.html`（單檔 133KB，無 build step 就可以跑）。

## 快速開始

```bash
cd /opt/data/policy-islands
python3 -m http.server 8791
# 開 http://localhost:8791/index.html
```

單檔 `index.html`（約 133KB），無需 build（除非改 `src/`）。

## CDN 依賴與 fallback

Three.js r160 由 CDN 載入，**有自動 fallback**：

1. 先 `HEAD` 探測 `cdn.jsdelivr.net`（primary）
2. 失敗 → 自動改用 `unpkg.com`
3. 動態注入 importmap，再 top-level await 載入 core + 4 個 addon

- `?cdn=fallback` — 強制走 unpkg（測試用，已實測通過：0 error、7 島正常）
- `__pid().cdn` — 睇實際用咗邊個 CDN

**限制**：如果用戶網絡同時擋晒 jsdelivr 同 unpkg，就會白屏（無 Three.js = 零場景）。
徹底解決要 self-host Three.js（`npm i three` 然後抄 `build/` + `examples/jsm/` 落 `cf-dist/`，
需 +700KB，之後完全離線可用）。

---

## 內容

| 項目 | 內容 |
|---|---|
| 政策島 | 00 市政 / 01 交通 / 02 教育 / 03 醫療 / 04 房屋 / 05 環境 / 06 經濟 |
| 細項 | 21 個（每島 3 個），每個有 3 個大數字磚 + 時程軸 + 資料來源 + 更新頻率 |
| 協作線 | 12 條（6 官方正式 / 4 主題協作 / 2 規劃中），Dijkstra 沿路網算路線 |
| 小人 | 108 個，10 種角色（公務員／居民／長者／學童／家長／通勤族／農夫／工人／研究員／旅客） |

---

## 操作

| 操作 | 說明 |
|---|---|
| 拖曳 | 旋轉鏡頭 |
| 滾輪 / 雙指 | 縮放 |
| 點擊 | 選島 → 細項 → 協作線 → 小人（統一流程：高亮 → 顯示協作線 → 飛行 → 開卡片） |
| 方向鍵 | 旋轉鏡頭 |
| Esc | 關閉卡片 |
| 左上工具列 | 全景 / 清單 / 說明 |
| 底部 HUD | 時段（清晨 06 / 白天 12 / 黃昏 18 / 夜晚 21）+ 名牌 / 搬運 / 協作線 / 暫停 / 鳥瞰 / 日誌 |

---

## URL 參數

| 參數 | 效果 |
|---|---|
| `?lang=en` | 英文介面（預設繁體中文） |
| `?q=low` | 低畫質模式（無陰影、低 pixelRatio、背景樹減量）—— 舊手機 / 冇 GPU 環境 |
| `?still=1` | 凍結時鐘與動畫（用於自動化測試 / 截圖） |
| `?cdn=fallback` | 強制用 unpkg CDN（測試 fallback 用） |

---

## 技術

- **Three.js r160**（CDN + 自動 fallback，見上）+ CSS2DRenderer + OrbitControls
- **InstancedMesh 零件庫**：10 種幾何 kind、1143 個 instance、89 draw calls
- 地形：170² PlaneGeometry（160 細分）＋ fbm 噪聲 ＋ 梯田量化 ＋ 頂點色分帶
- 日夜：時鐘 10 分鐘量化，太陽方位按規格公式；夜晚 hemi 較強（冷藍但看得清楚）
- 效能：只在需要時 render（`STATE.dirty`）、pixelRatio ≤ 1.4、小物件 LOD（距離 ≥26 隱藏）

---

## 開發

```bash
# 改 src/*.js 之後
python3 build.py     # 組裝 index.html + node --check 語法閘
```

- `src/head.html` — HTML head / CSS / DOM
- `src/01-data.js` — `ISLANDS` / `ITEMS` / `FLOWS` 資料
- `src/02-scene.js` — renderer / camera / 燈光 / 天空 / 海 / 日夜循環
- `src/03-terrain.js` — 地形 / 背景樹 / 遠山 / 雲 / 海上點綴
- `src/04-buildings.js` — 零件庫 / archetype / 島 / 橋
- `src/05-walkers.js` — 小人 / 協作線 / badge / Dijkstra
- `src/06-select.js` — 選取 / 高亮 / 飛行 / 標籤避讓
- `src/07-ui.js` — 卡片 / 側欄 / HUD / 日誌 / i18n / 手機 sheet
- `src/08-boot.js` — resize / 主迴圈 / debug 鉤

規格同驗收標準見 `SPEC-v2.md`，開發規則見 `AGENTS.md`。

### Debug 鉤（瀏覽器 console）

```js
__pid()          // 狀態總覽（內容數量、draw calls、錯誤、選取狀態…）
__sample(5)      // framebuffer 取樣網格（天空/海/屋頂像素比例）
__dumpPNG()      // 匯出 WebGL framebuffer 為 PNG data URL
__probeWorld([[x,y,z]])  // 世界座標 → 螢幕像素 + 顏色
__pick(px, py)   // raycast 除錯
__internals      // 內部物件（camera / scene / DATA…）
```

---

## 手機版（≤ 800px）

- 側欄與卡片變成 bottom sheet（52% / 34%，可拖曳撐滿）
- HUD 收進「◷ 時間」按鈕
- 工具列改直排

## 無障礙

- `prefers-reduced-motion`：相機瞬移、時鐘與動畫凍結、協作線靜態
- 鍵盤可達（方向鍵 / Esc）
- 觸控目標 ≥ 44px


---

## 部署

### GitHub Pages（已上線）
Repo: `hkteddychan/policy-islands`（public）· Pages source = `main` root

```bash
# 改完先組裝
python3 build.py
# 推 index.html + src/ + worker.js，然後
curl -X POST -H "Authorization: Bearer $TOKEN" \
  https://api.github.com/repos/hkteddychan/policy-islands/pages/builds
```

⚠️ Pages 唔會自動 rebuild，改完 source 要手動 POST `/pages/builds`。

### Cloudflare Worker（單檔 worker.js）
```bash
python3 build.py
python3 - <<'PY'
from pathlib import Path
html = Path('index.html').read_text(encoding='utf-8')
safe = html.replace('\\','\\\\').replace('`','\\`').replace('${','\\${')
Path('worker.js').write_text(
  "const HTML = `%s`;\nexport default { async fetch(r,e,c){ return new Response(HTML,"
  "{headers:{'Content-Type':'text/html; charset=utf-8'}}); } };\n" % safe, encoding='utf-8')
PY
wrangler deploy worker.js --name policy-islands --compatibility-date 2024-09-01
```

需要 `CLOUDFLARE_API_TOKEN`（dash.cloudflare.com/profile/api-tokens → Edit Cloudflare Workers）。
冇 token 都可以用 `wrangler deploy --temporary` 試下，但係臨時帳戶、隨時失效。

### Cloudflare Pages（靜態）
```bash
mkdir -p cf-dist && cp index.html cf-dist/
wrangler pages deploy cf-dist --project-name policy-islands
```
