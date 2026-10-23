/* ============ 09 · net: WebSocket + mutations + 加建築 UI ============
   Phase 2/3/4 前端：匿名 session、WS 即時同步、加建築、新聞島合併。
   靜態版（GitHub Pages）冇後端 → 所有功能自動 skip，唔影響 demo。 */
(function () {
  // 後端 API 地址：同源部署（Cloudflare Worker）→ location.origin；
  // 靜態託管（GitHub Pages）→ 用已部署嘅 Worker。
  const API = (location.hostname.includes('github.io') || location.protocol === 'file:')
    ? 'https://policy-islands.teddy-spot.workers.dev'
    : location.origin;

  const NET = {
    token: localStorage.getItem('pi_token') || null,
    ws: null, connected: false, seq: 0,
    lastError: null, attempts: 0
  };
  window.__net = NET;

  async function ensureSession() {
    if (NET.token) return NET.token;
    try {
      const r = await fetch(API + '/api/session', { method: 'POST' });
      const d = await r.json();
      if (d && d.token) {
        NET.token = d.token;
        localStorage.setItem('pi_token', d.token);
        return d.token;
      }
    } catch (e) { NET.lastError = 'session: ' + (e && e.message); }
    return null;
  }

  // 拉一次完整世界（初次載入時合併 server 新增嘅 items/islands）
  async function fetchWorld() {
    try {
      const r = await fetch(API + '/api/world');
      if (!r.ok) return;
      const w = await r.json();
      NET.seq = w.seq || 0;
      applyServerWorld(w);
    } catch (e) { NET.lastError = 'world: ' + (e && e.message); }
  }

  function applyServerWorld(w) {
    if (!w || !w.items) return;
    for (const it of w.items) {
      if (!ITEMS[it.id] && it.islandId && window.__addItemMesh) {
        ITEMS[it.id] = it;
        window.__addItemMesh(it);
      }
    }
    for (const isl of w.islands || []) {
      if (isl.origin === 'news' && !ISL_BY_ID[isl.id] && window.__addIsland) {
        ISLANDS.push(isl);
        ISL_BY_ID[isl.id] = isl;
        window.__addIsland(isl);
        // 新聞島地標細項
        if (window.__addItemMesh) {
          for (const it of w.items) {
            if (it.islandId === isl.id && !ITEMS[it.id]) {
              ITEMS[it.id] = it;
              window.__addItemMesh(it);
            }
          }
        }
      }
    }
  }

  // 即時同步：長輪詢 /api/mutations?since=N（WS 喺呢個 DO 環境 handshake 後 message
  // 唔通 —— 實測 broadcast to 0 sockets；polling 100% 可靠，budget 內）
  function startPolling() {
    const poll = async () => {
      try {
        const r = await fetch(API + '/api/mutations?since=' + NET.seq);
        if (r.ok) {
          const d = await r.json();
          NET.connected = true;
          if (d.seq > NET.seq) {
            NET.seq = d.seq;
            for (const m of d.mutations || []) handleMutation(m);
          }
        }
      } catch (e) { NET.lastError = 'poll: ' + (e && e.message); }
      setTimeout(poll, 12000);   // 12 秒一次：10 用戶 ≈ 72k req/日，免費層內
    };
    poll();
  }

  function handleMutation(mut) {
    NET.seq = Math.max(NET.seq, mut.seq || 0);
    const p = mut.payload || {};
    if (mut.type === 'add_item' && p.item && !ITEMS[p.item.id]) {
      ITEMS[p.item.id] = p.item;
      if (window.__addItemMesh) window.__addItemMesh(p.item);
      toast('＋ ' + (p.item.name && p.item.name.zh) + ' 已加入世界');
    } else if (mut.type === 'add_island' && p.island && !ISL_BY_ID[p.island.id]) {
      if (window.__addIsland) {
        ISLANDS.push(p.island);
        ISL_BY_ID[p.island.id] = p.island;
        window.__addIsland(p.island);
      }
      toast('📰 新聞島「' + (p.island.name && p.island.name.zh) + '」出現');
    } else if (mut.type === 'add_flow' && p.flow) {
      if (!FLOWS.some(f => f.id === p.flow.id)) FLOWS.push(p.flow);
    }
  }

  // 提交 mutation（用戶加建築 / 加島）
  async function submitMutation(type, payload) {
    const token = await ensureSession();
    if (!token) throw new Error('無法建立 session');
    const r = await fetch(API + '/api/mutations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ type, payload })
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) throw new Error((d && d.error) || ('HTTP ' + r.status));
    NET.seq = Math.max(NET.seq, d.seq || 0);
    // server 已廣播；本地即時反映（如果 WS 未連上）
    if (!NET.connected) {
      if (type === 'add_item' && payload.item && !ITEMS[payload.item.id]) {
        ITEMS[payload.item.id] = payload.item;
        if (window.__addItemMesh) window.__addItemMesh(payload.item);
      }
      if (type === 'add_island' && payload.island) {
        if (window.__addIsland) {
          ISLANDS.push(payload.island);
          ISL_BY_ID[payload.island.id] = payload.island;
          window.__addIsland(payload.island);
        }
      }
    }
    return d;
  }

  /* ── 加建築 UI（FAB + modal）──────────────────────────────────────── */
  const MODEL_OPTIONS = [
    ['busstop', '🚏 巴士站'], ['tram', '🚋 叮叮'], ['starferry', '⛴️ 天星碼頭'],
    ['chaChaan', '☕ 茶餐廳'], ['temple', '🏯 文武廟'], ['market', '🥬 街市'],
    ['tonglau', '🏘️ 唐樓'], ['estate', '🏢 公屋'], ['skyscraper', '🏙️ 商廈'],
    ['pawnshop', '🀄 當鋪'], ['cinema', '🎬 戲院'], ['jockey', '🐎 馬會'],
    ['clinic', '🏥 診所'], ['classroom', '🏫 教室'], ['cottage', '🏠 小屋'],
    ['stall', '🧺 攤位'], ['lighthouse', '🗼 燈塔'], ['kcr', '🚂 火車站'],
    ['mahjong', '🀄 麻雀館'], ['pavilion', '⛱️ 涼亭'], ['bike', '🚲 單車架']
  ];
  let modalEl = null, fabEl = null;

  function injectAddUI() {
    if (document.getElementById('piFab')) return;
    const fab = document.createElement('button');
    fab.id = 'piFab';
    fab.textContent = '＋';
    fab.title = '加建築（市民提案）';
    fab.setAttribute('aria-label', '加建築');
    fab.style.cssText = 'position:fixed;right:18px;bottom:86px;z-index:60;width:52px;height:52px;border-radius:50%;border:none;background:#211d1d;color:#fff8f4;font-size:26px;font-weight:800;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.35);';
    fab.addEventListener('click', () => openModal());
    document.body.appendChild(fab);
    fabEl = fab;
  }

  function openModal() {
    if (modalEl) { modalEl.style.display = 'block'; return; }
    const overlay = document.createElement('div');
    overlay.id = 'piModal';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:70;background:rgba(33,29,29,.45);display:flex;align-items:center;justify-content:center;';
    const card = document.createElement('div');
    card.style.cssText = 'width:min(420px,90vw);max-height:86vh;overflow:auto;background:#fff8f4;border-radius:22px;padding:22px;box-shadow:0 18px 60px rgba(33,29,29,.4);';
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="margin:0;font-size:18px;">＋ 加建築（市民提案）</h3>
        <button id="piClose" style="background:none;border:none;font-size:22px;cursor:pointer;">✕</button>
      </div>
      <label style="font-size:12px;font-weight:700;color:#6b5c50;">揀島</label>
      <select id="piIsland" style="width:100%;padding:10px;border-radius:9px;border:1px solid #d8c8b4;margin:4px 0 12px;font-size:14px;"></select>
      <label style="font-size:12px;font-weight:700;color:#6b5c50;">揀建築</label>
      <select id="piModel" style="width:100%;padding:10px;border-radius:9px;border:1px solid #d8c8b4;margin:4px 0 12px;font-size:14px;"></select>
      <label style="font-size:12px;font-weight:700;color:#6b5c50;">名稱（1–24 字）</label>
      <input id="piName" maxlength="24" placeholder="例：街坊茶記" style="width:100%;padding:10px;border-radius:9px;border:1px solid #d8c8b4;margin:4px 0 16px;font-size:14px;box-sizing:border-box;" />
      <button id="piSubmit" style="width:100%;min-height:44px;border:none;border-radius:9px;background:#db6a41;color:#fff;font-size:15px;font-weight:800;cursor:pointer;">提交提案</button>
      <div id="piMsg" style="margin-top:10px;font-size:13px;min-height:18px;"></div>`;
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    modalEl = overlay;

    // fill islands
    const isel = card.querySelector('#piIsland');
    for (const I of ISLANDS) {
      const o = document.createElement('option');
      o.value = I.id; o.textContent = I.no + ' ' + I.name.zh;
      isel.appendChild(o);
    }
    // fill models
    const msel = card.querySelector('#piModel');
    for (const [k, label] of MODEL_OPTIONS) {
      const o = document.createElement('option');
      o.value = k; o.textContent = label;
      msel.appendChild(o);
    }
    card.querySelector('#piClose').addEventListener('click', () => { overlay.style.display = 'none'; });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.style.display = 'none'; });
    card.querySelector('#piSubmit').addEventListener('click', async () => {
      const msgEl = card.querySelector('#piMsg');
      const islandId = isel.value, model = msel.value, name = card.querySelector('#piName').value.trim();
      if (!name) { msgEl.textContent = '❌ 請填名稱'; msgEl.style.color = '#a83232'; return; }
      const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const item = { id, islandId, no: 99, model, name: { zh: name, en: name } };
      msgEl.textContent = '⏳ 提交中…';
      try {
        const d = await submitMutation('add_item', { item });
        msgEl.textContent = '✅ 已提交（seq ' + d.seq + '）—— 世界已更新';
        msgEl.style.color = '#2f6f4f';
        card.querySelector('#piName').value = '';
      } catch (e) {
        msgEl.textContent = '❌ ' + (e && e.message);
        msgEl.style.color = '#a83232';
      }
    });
  }

  /* ── toast ─────────────────────────────────────────────────────────── */
  function toast(text) {
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

  /* ── boot ──────────────────────────────────────────────────────────── */
  function boot() {
    // 靜態 host（GitHub Pages / file）→ 只做一次 world 合併，唔連 WS
    const staticHost = location.hostname.includes('github.io') || location.protocol === 'file:';
    if (staticHost) {
      fetchWorld();
      return;
    }
    fetchWorld();
    startPolling();
    injectAddUI();
    window.__submitMutation = submitMutation;
    window.__piRefreshSidebar = () => {};
  }
  if (document.readyState === 'complete') boot();
  else window.addEventListener('load', boot);
})();
