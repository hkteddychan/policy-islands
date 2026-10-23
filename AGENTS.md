# 政策島 Policy Islands — 開發規則（OpenCode 必讀）

## 專案結構
```
/opt/data/policy-islands/
├── index.html          ← 組裝產物（唔好直接手改）
├── build.py            ← 組裝 + 語法閘（唯一 build 入口）
├── SPEC-v2.md          ← 規格 + 驗收標準（本次任務依據）
├── src/
│   ├── head.html       ← HTML head + CSS + DOM（唔好改，除非任務要求）
│   ├── 00-imports.js   ← three + addons import
│   ├── 01-data.js      ← ISLANDS / ITEMS / FLOWS 資料
│   ├── 02-scene.js     ← renderer / camera / lights / sky / sea / day-cycle
│   ├── 03-terrain.js   ← 盆地地形 / 背景樹 / 遠山 / 雲 / 海上點綴
│   ├── 04-buildings.js ← instanced 零件庫 / archetype / 島 / 橋
│   ├── 05-walkers.js   ← 小人 / 協作線 tube / badge / Dijkstra
│   ├── 06-select.js    ← 選取 / 高亮 / 飛行 / 標籤避讓
│   ├── 07-ui.js        ← 卡片 / 側欄 / HUD / 日誌 / i18n / 手機 sheet
│   └── 08-boot.js      ← resize / 主迴圈 / debug 鉤
└── backup/             ← 舊版備份（唔好改）
```

## 硬性規則（違反 = 任務失敗）
1. **只改 `src/*.js`（同需要時 `src/head.html`），唔好直接改 `index.html`**。
   `index.html` 由 `python3 build.py` 自動生成。
2. **每次改完一定要跑**：`cd /opt/data/policy-islands && python3 build.py`
   → 必須見到 `ASSEMBLED ... | 2 JS blocks OK` 且無 `SYNTAX ERROR`。
   如果 build.py 報錯 → 修到過先算完成。
3. **唔准刪除／改名呢啲 debug 鉤**（驗收用）：
   `window.__pid` `window.__sample` `window.__dumpPNG` `window.__probeWorld`
   `window.__internals` `window.__pick` `window.__errs` `window.__setGlow`
   `window.__setLampPool` `window.__setIslandLights`
4. **唔准引入新嘅外部 CDN 依賴**（Three.js 除外）。
5. **唔准加新框架／打包工具**。保持單檔 + importmap。
6. 所有 UI 文案用**繁體中文**；英文版靠 `data-en` 屬性 + `tr()` 函式，唔好喺 JS 裡面硬寫兩份字串。
7. 唔好改 `01-data.js` 嘅資料結構名稱（`ISLANDS` / `ITEMS` / `FLOWS` / `ISL_POS` / `ISL_NODES` / `ITEM_WORLD` / `FLOW_OBJ`），
   其他模組依賴佢哋。
8. 唔好將 `STATE.dirty` 機制廢掉（只在需要時 render）。
9. 唔好喺 `updateDayCycle` 之外重複計算日夜因子；night 只由 `dayWin` 推導（見 02-scene.js）。
10. 改完必須自查：搜尋自己改過嘅檔案，確認冇留低半改狀態（例如 variable 宣告咗但冇用、
    function 定義咗兩次、舊嘅 `old` 字串殘留）。

## 技術陷阱（已經踩過，唔好再踩）
- `mergeGeometries` 要求所有 geometry **index 一致** → 一律先 `.toNonIndexed()`（用 `ni()` helper）。
- `CSS2DRenderer` 必須 `new CSS2DRenderer({element: host})`；事後賦 `.domElement` **無效**。
- `InstancedMesh.setColorAt` 之後要 `mesh.instanceColor.needsUpdate = true`。
- Raycast 對 InstancedMesh 要用 `hit.instanceId` 對回原始 record。
- 地形外圈（r>68）如果唔沉入海面，會變成一大片綠色台地擋住城市。
- 相機側（+z, camSide）地形要乘低並沉入潟湖。
- 環狀山半徑要 > 城市半徑（城市島群 r=22，山帶要 r≥38），否則會埋咗島。

## 交付要求
- 完成後**唔好**自己宣稱「已驗證」—— 瀏覽器驗證由 Hermes 做。你只需要：
  1. `python3 build.py` 通過
  2. 列出你改過嘅檔案 + 每項改動嘅一行說明
  3. 列出你**未能**完成嘅項目（如果有）
- 唔好修改 `backup/` 目錄。
- 唔好執行 `git commit` 或 push。
