/* ============ 10 · gameplay: 提案投票 / what-if 模擬 / 每日任務 / 新聞島認領 =======
   Phase 5 四項新功能（全部前端，後端 API 喺 src/worker/）：
   A. 市民提案投票制   —— 提交→提案→投票→≥5 票支持先落世界
   B. 政策影響 what-if —— 撳細項，沿 FLOWS 擴散顯示影響波
   C. 每日任務 + 徽章   —— 每日重置，完成 +15 分
   D. 新聞島認領 + 支持 —— 3 日內認領 +25 分，支持度 ≥10 島變大
   靜態版（GitHub Pages）冇後端 → 自動 skip，唔影響 demo。 */
(function () {
  const API = (location.hostname.includes('github.io') || location.protocol === 'file:')
    ? 'https://policy-islands.teddy-spot.workers.dev'
    : location.origin;

  const G = {
    proposals: [], threshold: 5,
    votes: {},            // islandId -> {support, claim}
    tasks: [], day: '',
    islandVotes: {},      // 我自己投過嘅：islandId -> {support:bool, claim:bool}
    taskHits: { build: 0, news: 0, flow: 0, vote: 0 },
    booted: false,
    // 世界事件（11-vibe 重播會讀）：提案通過 / 認領 / 支持 / 加建築
    events: []
  };
  window.__gameplay = G;

  function token() { return localStorage.getItem('pi_token') || ''; }

  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {});
    if (token()) headers['Authorization'] = 'Bearer ' + token();
    if (opts.body) headers['Content-Type'] = 'application/json';
    const r = await fetch(API + path, Object.assign({}, opts, { headers }));
    return { ok: r.ok, status: r.status, data: await r.json().catch(() => null) };
  }

  async function mutate(type, payload) {
    if (!token()) {
      // 先攞 session
      try {
        const r = await fetch(API + '/api/session', { method: 'POST' });
        const d = await r.json();
        if (d && d.token) { localStorage.setItem('pi_token', d.token); }
      } catch (e) { /* fallthrough */ }
    }
    const r = await api('/api/mutations', { method: 'POST', body: JSON.stringify({ type, payload }) });
    if (!r.ok) throw new Error((r.data && r.data.error) || ('HTTP ' + r.status));
    return r.data;
  }

  function toast(text) {
    // ⚠️ 唔可以喺呢度寫 window.__piToast = toast（自我引用 → 無限遞歸 → stack overflow）。
    // 09-net.js 負責掛 window.__piToast；呢度只係 fallback。
    if (typeof window.__piToast === 'function' && window.__piToast !== toast) { window.__piToast(text); return; }
    let t = document.getElementById('piToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'piToast';
      t.style.cssText = 'position:fixed;top:16px;right:16px;z-index:80;background:#211d1d;color:#fff8f4;padding:10px 16px;border-radius:12px;font-size:13px;box-shadow:0 6px 20px rgba(0,0,0,.35);max-width:300px;opacity:0;transition:opacity .3s;';
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.style.opacity = '1';
    clearTimeout(t._h);
    t._h = setTimeout(() => { t.style.opacity = '0'; }, 3200);
  }
  // 註：window.__piToast 由 09-net.js 掛（單一實作，避免自我引用）

  /* ══════════════════════════════════════════════════════════════════
     A. 市民提案投票制
     ══════════════════════════════════════════════════════════════════ */
  async function loadProposals() {
    const r = await api('/api/proposals');
    if (!r.ok || !r.data) return;
    G.proposals = r.data.proposals || [];
    G.threshold = r.data.threshold || 5;
    if (typeof renderProposals === 'function') renderProposals();
  }

  window.__createProposal = null;   // 稍後指向實際函式（避免 hoisting 問題）
  async function createProposal(islandId, model, nameZh) {
    const id = 'p-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' +
      Math.random().toString(36).slice(2, 6);
    await mutate('create_proposal', {
      proposal: { id, islandId, name: { zh: nameZh, en: nameZh }, model }
    });
    toast('📝 提案已提交，等其他人投票支持');
    await loadProposals();
    return id;
  }

  async function voteProposal(proposalId, dir) {
    await mutate('vote_proposal', { vote: { proposalId, dir } });
    G.taskHits.vote++;
    await loadProposals();
    await loadTasks();
    toast(dir === 'for' ? '🙌 已投支持票' : '👎 已投反對票');
    const pr = G.proposals.find(x => x.id === proposalId);
    if (pr) G.events.push({ icon: dir === 'for' ? '🙌' : '👎', t: '而家', text: (pr.name.zh || '提案') + ' 收到' + (dir === 'for' ? '支持票' : '反對票'), islandId: pr.islandId });
  }

  /* ══════════════════════════════════════════════════════════════════
     B. 政策影響 what-if 模擬
     ══════════════════════════════════════════════════════════════════ */
  // 影響係「政策協作」語意嘅 mock 權重（每條 flow 有方向性影響），純前端。
  const IMPACT = {
    official:  { base: 1.0,  label: '官方' },
    thematic: { base: 0.6,  label: '主題' },
    pending:  { base: 0.35, label: '規劃中' }
  };
  const DIRECTION_SEED = 7;

  function flowWeight(f) {
    const imp = IMPACT[f.kind] || IMPACT.pending;
    // 用 id hash 做穩定方向（+1/-1），令同一條線每次結果一致
    let h = DIRECTION_SEED;
    for (let i = 0; i < f.id.length; i++) h = (h * 31 + f.id.charCodeAt(i)) >>> 0;
    const sign = (h % 2 === 0) ? 1 : -1;
    return { mag: imp.base * (0.6 + (h % 40) / 100), sign, kind: f.kind };
  }

  // 從某個 item 出發，沿 FLOWS 做 BFS 擴散，回傳 {islandId: impact}
  function simulateImpact(startIslandId, startItemId) {
    const adj = {};
    for (const f of FLOWS) {
      if (!adj[f.from]) adj[f.from] = [];
      if (!adj[f.to]) adj[f.to] = [];
      adj[f.from].push({ to: f.to, flow: f });
      adj[f.to].push({ to: f.from, flow: f });
    }
    const seen = new Set([startIslandId]);
    const q = [{ id: startIslandId, acc: 1, depth: 0, path: [] }];
    const out = {};
    out[startIslandId] = { pct: 0, depth: 0, sign: 0, path: [] };
    while (q.length) {
      const cur = q.shift();
      const edges = adj[cur.id] || [];
      for (const e of edges) {
        if (seen.has(e.to)) continue;
        const w = flowWeight(e.flow);
        const acc = cur.acc * w.mag * w.sign;
        seen.add(e.to);
        const depth = cur.depth + 1;
        const path = cur.path.concat([{ flow: e.flow, sign: w.sign }]);
        const pct = Math.round(acc * 42 * (w.sign > 0 ? 1 : -1));
        out[e.to] = { pct, depth, sign: Math.sign(acc), path, mag: Math.abs(acc) };
        q.push({ id: e.to, acc, depth, path });
      }
    }
    return out;
  }

  /* ── 島嶼縮放（支持度 ≥10 → 變大）─────────────────────────────── */
  const ISLAND_SCALE = {};
  function scaleIsland(islandId, factor) {
    const node = (typeof ISL_NODES !== 'undefined') ? ISL_NODES[islandId] : null;
    if (!node) return false;
    ISLAND_SCALE[islandId] = (ISLAND_SCALE[islandId] || 1) * factor;
    node.scale.setScalar(ISLAND_SCALE[islandId]);
    if (typeof STATE !== 'undefined') STATE.dirty = true;
    return true;
  }
  window.__scaleIsland = scaleIsland;

  /* ── 島嶼高亮（what-if 受影響島）────────────────────────────────── */
  let islandTint = {};
  // ⚠️ 效能：ISL_NODES 每個島都掛住大量 InstancedMesh（成百上千個），
  // 逐個 traverse + 改 material.color 會令主 thread 停頓數秒 → 用戶體驗崩。
  // 改用「一次性建立 mesh 清單 + 只改有 instanceColor 嘅 mesh」，並且
  // 對每個 material 只做一次 setHex/lerp（唔好每 frame 做）。
  // 重用 06-select.js 既有嘅 instanced 高亮系統（kitList / mixC / TINT_CORAL）：
  // rec.base 係原始色，rec.item 對應細項 → 可以知道每個 instance 屬於邊個島。
  // 自己 traverse 所有 mesh 會有幾千個 → 主 thread 卡死數秒，唔可以咁做。
  const TINT_GREEN = 0x2f6f4f, TINT_RED = 0xa83232;
  const tintColorCache = {};
  function tintColor(hex) {
    if (!tintColorCache[hex]) tintColorCache[hex] = new THREE.Color(hex);
    return tintColorCache[hex];
  }
  function applyIslandTint() {
    if (typeof kitMeshes === 'undefined' || typeof kitList === 'undefined') return;
    for (const kind in kitMeshes) {
      const mesh = kitMeshes[kind];
      const list = kitList[kind];
      for (let i = 0; i < list.length; i++) {
        const rec = list[i];
        let c = rec.base;
        if (rec.item) {
          const it = ITEMS[rec.item];
          const islId = it ? (it.isl || it.islandId) : null;
          const col = islandTint[islId];
          if (col) {
            c = mixC.copy(rec.base).lerp(tintColor(col), 0.26).clone();
          } else if (SEL.kind === 'item' && SEL.id === rec.item) {
            c = mixC.copy(rec.base).lerp(TINT_CORAL, 0.22).clone();
          } else if (SEL.kind === 'island' && islId === SEL.id) {
            c = mixC.copy(rec.base).lerp(TINT_CORAL, 0.10).clone();
          } else if (itemActiveNow(rec.item)) {
            c = mixC.copy(rec.base).lerp(TINT_YELLOW, 0.22).clone();
          }
        }
        mesh.setColorAt(i, c);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    if (typeof STATE !== 'undefined') STATE.dirty = true;
  }
  function highlightIslands(map) {
    islandTint = map || {};
    applyIslandTint();
  }
  window.__highlightIslands = highlightIslands;

  let impactOverlay = null;
  function clearImpact() {
    if (impactOverlay && impactOverlay.parentNode) impactOverlay.parentNode.removeChild(impactOverlay);
    impactOverlay = null;
    lastImpactKey = '';
    try { highlightIslands({}); } catch (e) {}
    if (typeof STATE !== 'undefined') STATE.dirty = true;
  }

  let lastImpactKey = '';
  function renderImpact(startIslandId, startItemId, startName) {
    // 同一 item 唔重覆計算（避免連續點擊重繪）
    const key = startIslandId + '/' + startItemId;
    if (key === lastImpactKey && impactOverlay) return;
    clearImpact();          // 呢度會清 lastImpactKey
    lastImpactKey = key;    // 所以要喺 clearImpact 之後再 set
    const sim = simulateImpact(startIslandId, startItemId);
    const box = document.createElement('div');
    box.id = 'piImpact';
    box.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:20px;z-index:65;width:min(560px,94vw);background:#fff8f4;border-radius:18px;padding:16px 18px;box-shadow:0 14px 46px rgba(33,29,29,.34);border:2px solid #db6a41;';
    const rows = Object.keys(sim)
      .filter(id => id !== startIslandId)
      .sort((a, b) => sim[a].depth - sim[b].depth)
      .map(id => {
        const isl = ISL_BY_ID[id];
        const s = sim[id];
        const name = isl ? (isl.name && isl.name.zh) : id;
        const arrow = s.pct >= 0 ? '▲' : '▼';
        const col = s.pct >= 0 ? '#2f6f4f' : '#a83232';
        const via = s.path.length ? s.path[s.path.length - 1].flow.carry?.zh || '' : '';
        return '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 8px;border-radius:9px;background:#f7ece0;margin-bottom:5px;">' +
          '<span style="font-size:13px;">' + (isl ? isl.no : '?') + ' ' + name + (via ? ' <small style="color:#8a7a6c;">（經：' + via + '）</small>' : '') + '</span>' +
          '<b style="color:' + col + ';font-size:14px;white-space:nowrap;">' + arrow + ' ' + Math.abs(s.pct) + '%</b></div>';
      }).join('');
    box.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
        '<b style="font-size:15px;">🔮 政策影響模擬：' + (startName || '此項') + '</b>' +
        '<button id="piImpactClose" style="background:none;border:none;font-size:20px;cursor:pointer;">✕</button>' +
      '</div>' +
      '<div style="font-size:11px;color:#8a7a6c;margin-bottom:8px;">假設此項政策改變，沿協作關係擴散嘅估算影響（方向同幅度按協作線權重推算）</div>' +
      (rows || '<div style="font-size:13px;color:#6b5c50;">此項冇連接其他島 — 冇擴散影響</div>');
    document.body.appendChild(box);
    impactOverlay = box;
    box.querySelector('#piImpactClose').addEventListener('click', clearImpact);

    // 高亮受影響島（用現有 select 機制嘅 island group）
    const hi = {};
    for (const id of Object.keys(sim)) {
      if (id !== startIslandId) hi[id] = sim[id].pct >= 0 ? '#2f6f4f' : '#a83232';
    }
    try { highlightIslands(hi); } catch (e) {}
    if (typeof STATE !== 'undefined') STATE.dirty = true;
  }
  window.__simulateImpact = renderImpact;

  /* ══════════════════════════════════════════════════════════════════
     C. 每日任務 + 成就徽章
     ══════════════════════════════════════════════════════════════════ */
  async function loadTasks() {
    const r = await api('/api/tasks');
    if (!r.ok || !r.data || !r.data.tasks) return;
    G.tasks = r.data.tasks;
    G.day = r.data.day || '';
    if (typeof renderTasks === 'function') renderTasks();
  }

  // 本地 hit 追蹤（news/flow 係瀏覽行為 → 需要送 server 記錄）
  // build / vote 兩個任務由 mutation 自動觸發（server 端 bumpTask），
  // news / flow 要前端主動送「progress」type mutation。
  // 每個任務只送一次／節流（避免 spam server + 撞限流）
  const hitSent = {};
  async function hitTask(id) {
    G.taskHits[id] = (G.taskHits[id] || 0) + 1;
    if (typeof renderTasks === 'function') renderTasks();
    // server 有 done guard（完成咗唔再加）；但同一個任務未完成前唔好連發
    const t = G.tasks.find(x => x.id === id);
    if (t && t.done) return;               // 已完成 → 唔使再送
    if (hitSent[id] && Date.now() - hitSent[id] < 20000) return;  // 20 秒節流
    hitSent[id] = Date.now();
    try {
      await mutate('task_progress', { taskId: id });
      await loadTasks();
    } catch (e) { /* 靜態版冇後端 → 忽略 */ }
  }
  window.__hitTask = hitTask;

  /* ══════════════════════════════════════════════════════════════════
     D. 新聞島認領 + 支持
     ══════════════════════════════════════════════════════════════════ */
  async function loadIslandVotes() {
    const r = await api('/api/island-votes');
    if (!r.ok || !r.data) return;
    G.votes = r.data.votes || {};
    if (typeof renderIslandVotes === 'function') renderIslandVotes();
  }

  async function voteIsland(islandId, kind) {
    await mutate('vote_island', { vote: { islandId, kind } });
    if (kind === 'claim') {
      G.islandVotes[islandId] = G.islandVotes[islandId] || {};
      G.islandVotes[islandId].claim = true;
      toast('🏷️ 已認領新聞島（+25 分）');
      G.events.push({ icon: '🏷️', t: '而家', text: '有人認領咗新聞島', islandId });
    } else {
      G.islandVotes[islandId] = G.islandVotes[islandId] || {};
      G.islandVotes[islandId].support = true;
      toast('🙌 已支持（+1 分）');
      G.events.push({ icon: '🙌', t: '而家', text: '有人支持咗新聞島', islandId });
      const v = G.votes[islandId] || { support: 0, claim: 0 };
      v.support = (v.support || 0) + 1;
      G.votes[islandId] = v;
      // 支持度 ≥10 → 島變大
      if (v.support >= 10 && window.__scaleIsland) {
        try { window.__scaleIsland(islandId, 1.25); toast('📈 呢個島支持度破 10，島嶼變大咗！'); } catch (e) {}
      }
    }
    await loadIslandVotes();
    await loadTasks();
  }

  /* ── UI：任務面板 + 提案列表 + 島票數 badge ───────────────────────── */
  let panelEl = null;
  function ensurePanel() {
    if (panelEl) return panelEl;
    const el = document.createElement('div');
    el.id = 'piGamePanel';
    el.style.cssText = 'position:fixed;right:18px;bottom:198px;z-index:60;width:250px;background:rgba(255,248,244,.94);backdrop-filter:blur(10px);border-radius:16px;padding:12px 13px;box-shadow:0 8px 26px rgba(33,29,29,.22);font-size:12px;display:none;';
    el.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;">' +
        '<b style="font-size:13px;">📋 今日任務</b><span id="piTaskDay" style="font-size:10px;color:#8a7a6c;"></span></div>' +
      '<div id="piTaskList"></div>' +
      '<div style="border-top:1px dashed #d8c8b4;margin:9px 0 7px;"></div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
        '<b style="font-size:13px;">📝 市民提案</b><span id="piPropCount" style="font-size:10px;color:#8a7a6c;"></span></div>' +
      '<div id="piPropList"></div>';
    document.body.appendChild(el);
    panelEl = el;
    return el;
  }

  function renderTasks() {
    const el = document.getElementById('piTaskList');
    if (!el) return;
    const dayEl = document.getElementById('piTaskDay');
    if (dayEl) dayEl.textContent = G.day || '';
    if (!G.tasks.length) { el.innerHTML = '<div style="color:#8a7a6c;">載入中…</div>'; return; }
    el.innerHTML = G.tasks.map(t => {
      const p = Math.min(t.progress || 0, t.target);
      const done = !!t.done;
      const pct = Math.round(p / t.target * 100);
      return '<div style="margin-bottom:7px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<span>' + (done ? '✅' : '⬜') + ' ' + t.label.zh + '</span>' +
          '<small style="color:#8a7a6c;">' + p + '/' + t.target + '</small>' +
        '</div>' +
        '<div style="height:5px;border-radius:3px;background:#e6d8c6;margin-top:3px;overflow:hidden;">' +
          '<div style="height:100%;width:' + pct + '%;background:' + (done ? '#2f6f4f' : '#db6a41') + ';"></div>' +
        '</div></div>';
    }).join('');
  }

  function renderProposals() {
    const el = document.getElementById('piPropList');
    if (!el) return;
    const cnt = document.getElementById('piPropCount');
    const pending = G.proposals.filter(p => p.status === 'pending');
    if (cnt) cnt.textContent = pending.length + ' 待決';
    if (!G.proposals.length) {
      el.innerHTML = '<div style="color:#8a7a6c;">未有提案。撳 ➕ 提交第一個！</div>';
      return;
    }
    el.innerHTML = G.proposals.slice(0, 6).map(p => {
      const isl = ISL_BY_ID[p.islandId];
      const need = Math.max(0, G.threshold - p.votesFor);
      const badge = p.status === 'approved' ? '<span style="color:#2f6f4f;font-weight:800;">✅ 已通過</span>'
        : p.status === 'rejected' ? '<span style="color:#a83232;font-weight:800;">❌ 已否決</span>'
        : '<span style="color:#8a7a6c;">仲差 ' + need + ' 票</span>';
      return '<div style="padding:6px 7px;border-radius:9px;background:#f7ece0;margin-bottom:5px;">' +
        '<div style="font-size:12px;font-weight:700;">' + p.name.zh + '</div>' +
        '<div style="font-size:10px;color:#8a7a6c;margin-bottom:4px;">' + (isl ? isl.no + ' ' + (isl.name.zh || '') : '') + ' · ' + badge + '</div>' +
        '<div style="display:flex;gap:5px;align-items:center;">' +
          '<button data-pid="' + p.id + '" data-dir="for" style="flex:1;min-height:26px;border-radius:7px;border:1px solid #db6a41;background:#fff;cursor:pointer;font-size:11px;">🙌 ' + p.votesFor + '</button>' +
          '<button data-pid="' + p.id + '" data-dir="against" style="flex:1;min-height:26px;border-radius:7px;border:1px solid #d8c8b4;background:#fff;cursor:pointer;font-size:11px;">👎 ' + p.votesAgainst + '</button>' +
        '</div></div>';
    }).join('');
    // 綁事件
    el.querySelectorAll('button[data-pid]').forEach(b => {
      b.addEventListener('click', async () => {
        b.disabled = true;
        try { await voteProposal(b.getAttribute('data-pid'), b.getAttribute('data-dir')); }
        catch (e) { toast('❌ ' + (e && e.message)); b.disabled = false; }
      });
    });
  }

  function renderIslandVotes() {
    // 喺島卡片 / 選取面板顯示支持度 badge
    const el = document.getElementById('piIslandVotes');
    if (!el) return;
    const cur = window.__currentIslandId;
    const v = G.votes[cur] || { support: 0, claim: 0 };
    const mine = G.islandVotes[cur] || {};
    el.innerHTML =
      '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">' +
        '<span style="font-size:11px;background:#f7ece0;border-radius:999px;padding:3px 9px;">🙌 ' + v.support + '</span>' +
        '<button id="piSupportBtn" style="font-size:11px;border-radius:999px;padding:3px 10px;border:1px solid #db6a41;background:#fff;cursor:pointer;"' +
          (mine.support ? ' disabled style="opacity:.5;cursor:default;"' : '') + '>支持</button>' +
        (cur && cur.startsWith('news-')
          ? '<button id="piClaimBtn" style="font-size:11px;border-radius:999px;padding:3px 10px;border:1px solid #58a6a6;background:#fff;cursor:pointer;"' +
            (mine.claim ? ' disabled style="opacity:.5;cursor:default;"' : '') + '>🏷️ 認領 (+25)</button>'
          : '') +
      '</div>';
    const sb = document.getElementById('piSupportBtn');
    if (sb) sb.addEventListener('click', async () => {
      sb.disabled = true;
      try { await voteIsland(cur, 'support'); } catch (e) { toast('❌ ' + (e && e.message)); sb.disabled = false; }
    });
    const cb = document.getElementById('piClaimBtn');
    if (cb) cb.addEventListener('click', async () => {
      cb.disabled = true;
      try { await voteIsland(cur, 'claim'); } catch (e) { toast('❌ ' + (e && e.message)); cb.disabled = false; }
    });
  }

  function togglePanel() {
    const el = ensurePanel();
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
    if (el.style.display === 'block') { loadTasks(); loadProposals(); loadIslandVotes(); }
  }

  /* ── FAB 按鈕（任務/提案面板）──────────────────────────────────────── */
  function injectFab() {
    if (document.getElementById('piTasksFab')) return;
    const b = document.createElement('button');
    b.id = 'piTasksFab';
    b.textContent = '📋';
    b.title = '今日任務 / 市民提案';
    b.setAttribute('aria-label', '今日任務');
    b.style.cssText = 'position:fixed;right:18px;bottom:206px;z-index:60;width:52px;height:52px;border-radius:50%;border:none;background:#58a6a6;color:#fff;font-size:21px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.3);';
    b.addEventListener('click', togglePanel);
    document.body.appendChild(b);
  }

  /* ── 攔截選取 → what-if 面板 + 任務 hit ─────────────────────────── */
  // 實際選擇入口係 06-select.js 嘅 select(kind, id)（kind = island|item|flow|walker）
  // 同 07-ui.js 嘅 openCard(kind, id)。呢度包一層做 hook。
  function hookSelection() {
    // 06-select.js 嘅 select() 會呼叫 window.__onSelect(kind, id)
    if (!window.__onSelect) {
      window.__onSelect = function (kind, id) {
        try {
          if (kind === 'island') {
            window.__currentIslandId = id;
            const isl = ISL_BY_ID[id];
            if (isl && String(id).startsWith('news-')) { G.taskHits.news++; hitTask('news'); }
            setTimeout(renderIslandVotes, 60);
          } else if (kind === 'item') {
            const it = (typeof ITEMS !== 'undefined') ? ITEMS[id] : null;
            // ⚠️ seed item 用 `isl` 欄位；用戶新增嘅 item 用 `islandId` —— 兩者都要支援
            const islId = it ? (it.isl || it.islandId) : null;
            if (it && islId) {
              G.taskHits.flow++; hitTask('flow');
              setTimeout(() => renderImpact(islId, it.id || id, it.name && it.name.zh), 120);
            }
          }
        } catch (e) { /* hook 唔好阻擋原本流程 */ }
      };
    }
    // 票數容器插入
    ensureVoteSlot();
  }

  // 喺右側 sidebar / 卡片區插入票數容器
  function ensureVoteSlot() {
    setTimeout(() => {
      if (document.getElementById('piIslandVotes')) return;
      // 優先掛喺 island card 內；搵唔到就掛去 body 右上角小卡
      const host = document.getElementById('piCardBody') || document.getElementById('piSideBody') ||
                   document.querySelector('#piCard') || document.querySelector('#piSidebar');
      const el = document.createElement('div');
      el.id = 'piIslandVotes';
      el.style.cssText = 'margin-top:8px;';
      if (host) host.appendChild(el);
      else {
        el.style.cssText += 'position:fixed;right:18px;top:120px;z-index:58;background:rgba(255,248,244,.92);border-radius:12px;padding:6px;box-shadow:0 4px 14px rgba(0,0,0,.18);';
        document.body.appendChild(el);
      }
      renderIslandVotes();
    }, 700);
  }

  /* ── boot ──────────────────────────────────────────────────────────── */
  function boot() {
    const staticHost = location.hostname.includes('github.io') || location.protocol === 'file:';
    if (staticHost) {
      // 靜態版：只開 what-if（純前端）+ 提案 UI（會失敗但唔阻）
      window.__createProposal = createProposal;
      hookSelection();
      injectFab();
      return;
    }
    window.__createProposal = createProposal;
    initAfterSession();
    injectFab();
    hookSelection();
    G.booted = true;
    // 每 25 秒刷新提案/票數
    setInterval(() => { loadProposals(); loadIslandVotes(); }, 25000);
  }

  async function ensureSessionLike() {
    // 09-net.js 已經有 ensureSession()（會寫 localStorage）→ 優先用佢，避免重複開 session
    if (token()) return;
    if (window.__net && typeof window.__net.ensureSession === 'function') {
      try { await window.__net.ensureSession(); } catch (e) {}
    }
    if (token()) return;
    try {
      const r = await fetch(API + '/api/session', { method: 'POST' });
      const d = await r.json();
      if (d && d.token) localStorage.setItem('pi_token', d.token);
    } catch (e) { /* ignore */ }
  }
  // 等 session ready 之後先載入需要 token 嘅資料（tasks）
  async function initAfterSession() {
    await ensureSessionLike();
    await loadTasks();
    await loadProposals();
    await loadIslandVotes();
  }

  if (document.readyState === 'complete') setTimeout(boot, 300);
  else window.addEventListener('load', () => setTimeout(boot, 300));
})();
