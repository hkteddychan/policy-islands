# 政策島 Policy Islands — 改良版規格（v2，含驗收標準）

> 現況：`/opt/data/policy-islands/index.html` 已經係可執行版本（單檔 128KB，Three.js r160）。
> 本 spec 用嚟驅動後續 5 個階段嘅改進。每項都附**可機械驗證**嘅驗收條件。
> 驗收工具：`/opt/data/policy-islands/build.py`（組裝 + node --check 閘）、
> `window.__pid()`（狀態鉤）、`window.__sample()` / `window.__dumpPNG()` / `window.__probeWorld()`（像素證據）。

---

## 0. 現況盤點（已完成，勿重做）

已實測通過（2026-10-23, browser_exec + gl.readPixels）：

- ✅ 7 座島（00 市政 + 01–06 六主題）、21 個細項、12 條協作線、113 個小人
- ✅ 零件庫 instancing：9 個 kind、1101 個 instance、94–119 draw calls
- ✅ 日夜循環：06:00 night=0.5 / 12:00 night=0 / 18:00 night=0.352 / 21:00 night=1（像素讀值已證實變色）
- ✅ 互動：sidebar 選島 → 島卡（協作 chips）→ 細項卡（3 個大數字磚 + 時程軸 + 160² 離屏 PNG 縮圖）
- ✅ CSS2D 標籤：7 顆島名 pill + 選島後 ①②③ pin
- ✅ 中英雙語：`?lang=en` → "00 Civic | 01 Transport | …"，7 themes / 12 flows
- ✅ 協作線開關：12 條全部可見；預設隱藏，選中相關島/線時自動顯示
- ✅ 0 console error；語法閘 `node --check` 全過

已修的 bug（唔好回退）：
1. `addEdge` 喺 ring node 未建好前呼叫 → 拆成兩 loop
2. `mergeGeometries` index 不一致（Icosahedron 無 index）→ 全部 `toNonIndexed()`
3. `CSS2DRenderer` 必須 constructor 傳 `{element}` 事後賦值無效
4. 地形平面外圈（r>68）平鋪在海平面 → 變成一大片綠色台地擋住城市 → `h -= smoothstep(68,84,r)*9`
5. 相機側（+z）地形壓低並沉入潟湖 → `h -= camSide*smoothstep(20,46,r)*5`
6. 環狀山原本 r=25–50 覆蓋島群 → 推去 r=34–78，城市盆地 r<32 壓到海平面

---

## 1. 階段 1 — 視覺打磨（最高優先，影響「第一眼專業感」）

### 1.1 城市可讀性（最重要）
目前近景只佔畫面 0.1% 像素，遠景山帶佔 40%。

**要求**
- 預設相機改為**斜俯視 45°**、距離 38–44、target (0, 3, 0)，令 7 座島佔畫面 **≥ 22%** 面積
- 城市周圍 0–32 範圍唔可以有山；山帶 r≥38
- 遠山剪影帶要壓低：最高點唔好高過地平線太多（山頂 y < 相機 target y + 6）
- 天空佔畫面頂部 **15–30%**（而家係 28%，合格）；地平線要見到海

**驗收**：`__probeWorld` 對 7 個島中心取樣 → 全部命中 island mesh 或 kit instance（唔可以命中 terrain）；
`__dumpPNG` 後 PIL 計算「珊瑚色屋頂像素」佔比 ≥ 0.8%、天空藍像素佔比 15–30%。

### 1.2 建物細節
- 每個細項模型底座加一圈 **0.06 厚嘅暗色陰影裙邊**（cylinder，半徑 1.05），令模型唔會「浮」喺島面
- 屋頂/牆身加 **0.012 大嘅接縫暗線**（沿屋簷）
- 巨型符號物件（book/coin/clock/globe）加 **金屬描邊**：0.03 厚嘅 torus 或 4 條棱線

**驗收**：近景 dumpPNG 對每個 archetype 取樣，邊緣不得出現與背景同色嘅像素斷層（用邊緣梯度檢查）。

### 1.3 材質與燈光
- 前景（islands）**唔用** flatShading；背景山/樹先 flatShading（已符合，確認唔好改錯）
- 主光陰影只由太陽投射；`shadow.bias` 保持 -0.0006，唔好出現 shadow acne
- 加 **1 個暖色 point light** 於市政廳鐘塔，夜晚強度隨 night 上升（已部分做到，補街燈 point light 更佳：每島 1 盞，強度 night × 2.5）

---

## 2. 階段 2 — 資料與內容深度

### 2.1 細項數據
- 每個細項要有 **3 個大數字磚**（已有），但要加 **「來源」欄**（例：運輸署 2026 年報）同 **「統計年度」**
- 每個細項加 **1 個「協作頻率」** 標籤（每日/每週/每月/每季）

### 2.2 協作線
- 每條協作線加 **「上一次更新」日期** 同 **「涉及部門數」**
- 協作線卡加 **「依據等級」說明**（A 級：雙方正式文件；B 級：單方會議紀錄；C 級：規劃中）
- 12 條線的 kind 分佈目前 5/4/3 → 改成 **6 official / 4 thematic / 2 pending**（pending 太唔夠睇唔到效果）

### 2.3 內容合理度（審核重點）
- 交通 → 教育（校車路線圖）✅ 合理
- 教育 → 醫療（健康紀錄）✅
- 醫療 → 房屋（診所名單）✅
- 房屋 → 經濟（房屋配額）✅
- 經濟 → 交通（隧道模型）✅
- 環境 → 交通（單車網絡）✅
- 交通 → 環境（車流排放）✅
- 教育 → 經濟（技能證書）✅
- 環境 → 房屋（綠化建築標準）✅
- 醫療 → 經濟（長者照預算）⚠️ **改為「醫療 → 經濟（醫療開支佔比）」**
- 房屋 → 教育（校舍需求清單）✅
- 經濟 → 市政（稅收影響估算）✅

---

## 3. 階段 3 — 互動與可及性

### 3.1 選取流程（已通，但要補強）
- 點擊小人要開「搬運者卡」（已通）
- **鍵盤可達**：Tab 喺 sidebar 項目之間跳、Enter 選取；Esc 關卡（部分已有，要補 Tab）
- **搜尋要支援繁中注音/英文關鍵字**：搜「交通」「transport」「f1」都應該搵到

### 3.2 協作線互動
- 點擊協作線 → 開線卡 + **高亮該線兩端島**（唔止高亮線）
- 協作線 legend 要顯示每種樣式嘅實際線段（CSS border 已做到，要加「官方/主題/規劃中」中文已由 data-en 覆蓋）

### 3.3 名牌與 badge
- badge 圖示要對應**該協作線嘅搬運物**，唔係一個通欄 icon（現在用 flow.icon，要改成 carry 專屬 icon：書/硬幣/清單/巴士/單車/房屋/樹/十字）
- 名牌文字要有 **「正在搬 X」**（已有）

---

## 4. 階段 4 — 效能

- 目標：桌面 **60fps**、中端手機 **30fps**
- draw call 維持 **≤ 30 個靜態 draw call**（目前 94–119，因為地形/樹/海/雲/島各自算；可接受，但要提供 `?q=low` 降載路徑 —— 已有）
- `pixelRatio` 上限 1.4（已有）；手機額外減背景樹
- 隱藏小物件 LOD：**鏡頭距離 ≥ 26 時隱藏**小物件（目前未實作，要補）
- 只在需要時 render：動畫中先 render；已用 `STATE.dirty`

---

## 5. 階段 5 — 交付與部署

- 產物：`/opt/data/policy-islands/index.html`（單檔，無外部依賴除 CDN Three.js）
- **必須做 CDN fallback**：Three.js 改用 jsdelivr，若用戶網絡擋晒 → 自動切 unpkg（用 `<script type="module">` onerror 唔 work，要用 dynamic import try/catch）
- 部署：Cloudflare Pages 或 GitHub Pages（repo: `policy-islands`），落地後 **重新 fetch 帶 cache-buster** 確認 body 內有新 marker
- README 寫明：點開、鍵盤操作、手機 bottom sheet、?lang=en、?q=low

---

## 6. 驗收總表（每次改完必跑）

| # | 檢查 | 方法 | 通過標準 |
|---|---|---|---|
| 1 | 語法 | `python3 build.py` | 3 blocks OK，無 SYNTAX ERROR |
| 2 | 啟動 | browser_exec 開頁 | `__pid().errors.length === 0` |
| 3 | 內容 | `__pid()` | islands=7 items=21 flows=12 walkers=113 |
| 4 | DOM | `__pid().dom` | themes=7 flowRows=12 pinEls=3（選島後） |
| 5 | 像素 | `__dumpPNG` + PIL | 珊瑚屋頂 ≥0.8%、天空 15–30% |
| 6 | 互動 | sidebar 點擊 | 島卡標題正確、item 卡有 3 facts + 3 timeline + PNG 縮圖 |
| 7 | 日夜 | 4 個時段取樣 | night = 0.5 / 0 / 0.352 / 1 |
| 8 | 雙語 | `?lang=en` | labels 全英文 |
| 9 | 協作線 | 開 toggle | visibleFlows.length = 12 |
| 10 | 小人 | 動畫開 | walker0.t 隨時間變 |

---

## 7. 交付原則

1. **唔好重寫整個檔案** —— 用 `src/` 分模組 + `build.py` 組裝，改動只掂對應模組
2. 每改完必跑 build.py + 上面驗收表
3. 唔准刪 `window.__pid` / `__sample` / `__dumpPNG` / `__probeWorld` / `__internals` 呢啲驗證鉤
4. 唔准引入新 CDN 依賴（除非 spec 明講）
5. 所有中文用繁體
