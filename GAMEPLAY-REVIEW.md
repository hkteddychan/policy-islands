# 政策島 Policy Islands — Gameplay Logic Review

> 日期：2026-10-23 · 版本：Phase 2-4 完成後
> 目的：審視成個「遊戲循環」有咩問題、點樣令「多人加建築 + 新聞島」變成真正好玩嘅循環。

---

## 現有 Gameplay Loop（實測）

```
開 app → 睇 7 座島 → 撳島 → 睇細項卡（facts/timeline）
        → 撳協作線 → 睇搬運物（校車路線圖/健康紀錄…）
        → [新] FAB 加建築 → 揀島/模型/名 → 提交 → 全世界 12 秒內見到
        → [新] 每 2 小時 → 新聞島自動出現（標題島 + 地標細項）
        → 小人 136 個喺協作線上行嚟行去（純裝飾）
```

## 問題診斷（每項附嚴重度）

| # | 問題 | 嚴重度 | 影響 |
|---|---|---|---|
| 1 | **加建築冇後果** — 加完冇分數、冇成就、冇世界影響 | 🔴 高 | 冇動機持續玩 |
| 2 | **新聞島太被動** — 用戶只係「見到」，參與唔到 | 🔴 高 | 新聞島變背景噪音 |
| 3 | **冇目標** — 冇任務、冇每日挑戰、冇 win/lose | 🟡 中 | 用戶玩 3 分鐘就走 |
| 4 | **睇唔到其他人** — 多人世界但冇 presence | 🟡 中 | 冇「多人感」 |
| 5 | **發現性差** — 新島冇引導，內容靠「撳」 | 🟡 中 | 新用戶唔知有咩玩 |
| 6 | **冇經濟/平衡** — 島之間冇資源流動 | 🟢 低 | 策略深度不足 |

## 建議改進（按優先度）

### A. 貢獻分 + 排行榜（解決 #1，#6）
- 每個 `add_item` mutation → 該用戶 +10 分（server 計，`users.score`）
- 新聞島地標 → 第一個認領嘅用戶 +25 分
- 島卡顯示「市民提案 N 座 · 由 [user] 加入」
- 右側欄加「貢獻榜」tab（Top 5 市民）

### B. 新聞島「認領 + 反應」（解決 #2）
- 新新聞島出現時：島上 pulsing 光環 + 「NEW」badge 3 日
- 用戶可撳「🙌 支持」→ 支持度 ≥10 → 島 scale 增大（視覺反映民意）
- 支持度記入 `islands.votes`（DO SQLite）

### C. 每日任務（解決 #3，#5）
- 每日 3 任務，HUD 加「任務」按鈕：
  - 「今日加 1 座建築」（+10）
  - 「去 3 個新聞島打卡」（+5/島）
  - 「睇 1 條協作線」（+3）
- 完成晒 → 成就徽章（profile badge）

### D. Presence dots（解決 #4）
- 每位活躍用戶：世界顯示一粒 coral 光點（camera 位置）
- 行近 → 顯示名（「匿名市民 #12」）
- 用 polling seq 加 `presence` type mutation（30 秒 heartbeat）

### E. 島平衡 buff（解決 #6）
- 島 A 有 ≥5 座市民建築 → 島 A 嘅協作線流量 +20%（小人密集啲）
- 新聞島支持度 ≥20 → 自動生一條 pending 協作線連去最近主題島

---

## 推薦執行

**快贏（今次做）**：A（貢獻分 + 排行榜）＋ B 嘅 NEW badge。
**下一個 iteration**：C（每日任務）＋ D（presence）。
**之後**：E（島平衡）。

## 具體實作備忘

1. DO `users` 表加 `score INTEGER DEFAULT 0` → `applyMutation('add_item')` 時 `UPDATE users SET score = score + 10 WHERE token_hash = ?`（actorToken 係 hash prefix — 改為傳 full hash）
2. `/api/leaderboard` endpoint：`SELECT handle, score FROM users ORDER BY score DESC LIMIT 10`
3. 前端：右側欄加「貢獻榜」tab + 島卡「市民提案」行
4. 新聞島 NEW badge：`window.__addIsland` 之後加 pulsing CSS2D/Sprite
