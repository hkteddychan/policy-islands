你係「政策島 Policy Islands」3D 可視化專案嘅實作工程師。

## 背景
`/opt/data/policy-islands/index.html` 已經係可執行嘅 Three.js 單檔（128KB，r160）。
架構係分模組：src/*.js + build.py 組裝成單檔。

**先讀 `/opt/data/policy-islands/AGENTS.md`**（開發規則，硬性要求），
再讀 `/opt/data/policy-islands/SPEC-v2.md`（規格 + 驗收標準）。

## 你今次嘅任務（只做呢 4 項，唔好擴張範圍）

### 任務 1 — 城市可讀性（最重要）
現況：近景城市只佔畫面 0.1% 像素，遠景山帶佔 40%，畫面中部被一片綠色地形佔滿。
要求（見 SPEC-v2 §1.1）：
- 預設相機改為斜俯視，令 7 座島佔畫面 **≥ 22%** 面積、天空佔畫面頂部 15–30%
- 環狀山半徑由 r=34–78 再推遠（改 04-buildings 或 03-terrain 對應位置），
  **城市周圍 0–32 範圍唔可以有山**（現在環狀山起點 r=34，但要確認加 noises 後唔會侵入 r<32）
- 遠山剪影帶（3 圈 MeshBasic cylinder）壓低，最高點唔好高過相機 target 太多
- 相機位置約 (34, 18, 54) 起步，請自行微調令城市更突出

### 任務 2 — 建物細節（SPEC-v2 §1.2）
- 每個細項模型底座加一圈 0.06 厚暗色「陰影裙邊」cylinder（半徑 1.05 倍），令模型唔會浮喺島面
  （改 `04-buildings.js` 嘅 `makeBuilder` 或各 ARCH 函式）
- 巨型符號物件（book / coin / clock / globe）加金屬描邊（torus 或棱線，0.03 厚）

### 任務 3 — 小物件 LOD（SPEC-v2 §4）
- 鏡頭距離 **≥ 26** 時隱藏小物件（盆栽、灌木、花、長椅、串燈等）
- 實作方法：喺 `04-buildings.js` 標記細項物件時加 `small: true` flag，
  然後喺 `08-boot.js` 主迴圈每 0.25 秒檢查相機到島嘅距離，超過 26 就把該島細項 instance 縮到 0，
  接近時還原
- 注意：setMatrixAt 完要 `instanceMatrix.needsUpdate = true`

### 任務 4 — 資料內容修正（SPEC-v2 §2.2 / §2.3）
改 `src/01-data.js`：
- 12 條協作線 kind 分佈改成 **6 official / 4 thematic / 2 pending**
- 醫療 → 經濟 嗰條嘅 carry 由「長者照護預算」改成 **「醫療開支佔比」**（note 同步改寫，要合理）
- 每條協作線加兩個欄位：`updated`（例如 "2026 Q3"）同 `depts`（涉及部門數，例如 2）
- 每個細項加 `src`（資料來源字串，例如 "運輸署 2026 年報"）同 `freq`（"每日"/"每週"/"每月"/"每季"）
- 協作線卡要顯示 `updated` 同 `depts`（改 `src/07-ui.js` 嘅 openCard flow 分支）

## 驗收
完成後跑：
```bash
cd /opt/data/policy-islands && python3 build.py
```
必須輸出 `ASSEMBLED ... | 2 JS blocks OK` 且無 SYNTAX ERROR。

## 交付格式（你最後一段回覆必須包含）
1. 改過嘅檔案清單（每個一行說明改咗咩）
2. build.py 嘅實際輸出
3. 你**未能**完成嘅項目（如果有，講清楚點解）
4. 唔准宣稱「已驗證可用」—— 瀏覽器驗證由 Hermes 負責
