/* ============ 07 · UI: cards, sidebar, HUD, log, i18n, mobile ============ */

/* ---------- thumbnail offscreen render (160²) ---------- */
const thumbRT = new THREE.WebGLRenderTarget(160, 160, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
const thumbCam = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
const thumbCanvas = document.createElement('canvas');
thumbCanvas.width = 160; thumbCanvas.height = 160;
const thumbCtx = thumbCanvas.getContext('2d');
const thumbBuf = new Uint8Array(160 * 160 * 4);
function renderThumb(itemId) {
  const w = ITEM_WORLD[itemId];
  if (!w) return '';
  const it = ITEMS[itemId];
  const big = ['book', 'coin', 'clock', 'globe'].includes(it.model);
  const dist = big ? 6.2 : 4.6;
  thumbCam.position.set(w.pos.x + dist * 0.85, w.pos.y + dist * 0.62, w.pos.z + dist * 0.85);
  thumbCam.lookAt(w.pos.x, w.pos.y + 0.75, w.pos.z);
  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(thumbRT);
  renderer.clear();
  renderer.render(scene, thumbCam);
  renderer.readRenderTargetPixels(thumbRT, 0, 0, 160, 160, thumbBuf);
  renderer.setRenderTarget(prevTarget);
  // flip Y
  const img = thumbCtx.createImageData(160, 160);
  for (let y = 0; y < 160; y++) {
    const src = (159 - y) * 160 * 4, dst = y * 160 * 4;
    img.data.set(thumbBuf.subarray(src, src + 640), dst);
  }
  thumbCtx.putImageData(img, 0, 0);
  return thumbCanvas.toDataURL('image/png');
}

/* ---------- cards ---------- */
const cardBody = document.getElementById('cardBody');
function factTiles(item) {
  return `<div class="facts">${item.facts.map(f => `
    <div class="fact">
      <div class="bignum">${f.v}<span style="font-size:15px">${tr(f.u)}</span></div>
      <div class="k">${tr(f.k)}</div>
    </div>`).join('')}</div>`;
}
function timelineHTML(item) {
  return `<div class="tl">${item.timeline.map(t => `<div><div class="d">${t.d}</div><div class="t">${tr(t.t)}</div></div>`).join('')}</div>`;
}
function openCard(kind, id) {
  const card = document.getElementById('card');
  card.hidden = false;
  if (kind === 'island') {
    const I = ISL_BY_ID[id];
    const ids = Object.keys(ITEMS).filter(k => ITEMS[k].isl === id);
    const fs = FLOWS.filter(f => f.from === id || f.to === id);
    cardBody.innerHTML = `
      <div class="cardicon">${I.icon}</div>
      <div class="eyebrow">${I.no} · ${LANG === 'en' ? 'ISLAND' : '政策島'}</div>
      <div class="cardtitle">${tr(I.name)}</div>
      <div class="cardsum">${tr(I.summary)}</div>
      <div class="eyebrow" style="margin-top:8px">${LANG === 'en' ? 'INITIATIVES' : '細項'}</div>
      ${ids.map(k => `<div class="itemli" data-item="${k}"><span class="pin1">${['①', '②', '③', '④', '⑤', '⑥'][ITEMS[k].no - 1]}</span><span>${tr(ITEMS[k].name)}</span></div>`).join('')}
      <div class="eyebrow" style="margin-top:12px">${LANG === 'en' ? 'COLLABORATIONS' : '協作關係'}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
        ${fs.map(f => `<span class="chip" data-flow="${f.id}">${f.kind === 'official' ? '●' : f.kind === 'thematic' ? '╌' : '⋯'} ${tr(f.carry)}</span>`).join('')}
      </div>`;
  } else if (kind === 'item') {
    const it = ITEMS[id];
    const I = ISL_BY_ID[it.isl];
    const w = ITEM_WORLD[id];
    const thumb = renderThumb(id);
    cardBody.innerHTML = `
      <div class="eyebrow">${I.no} · ${tr(I.name)}</div>
      <div class="cardtitle">${['①', '②', '③', '④', '⑤', '⑥'][it.no - 1]} ${tr(it.name)}</div>
      <div style="display:flex;gap:12px;align-items:flex-start;margin-top:8px">
        <img src="${thumb}" width="120" height="120" style="border-radius:14px;box-shadow:0 6px 18px #4a2a1422;border:1px solid #eee0cf;background:#eef3f2" alt="">
        <div style="flex:1">${factTiles(it)}</div>
      </div>
      <div class="eyebrow" style="margin-top:10px">${LANG === 'en' ? 'TIMELINE' : '時程'}</div>
      ${timelineHTML(it)}`;
  } else if (kind === 'flow') {
    const f = FLOW_OBJ[id].def;
    const o = FLOW_OBJ[id];
    cardBody.innerHTML = `
      <div class="eyebrow">${LANG === 'en' ? 'COLLABORATION' : '協作線'} · ${f.kind === 'official' ? (LANG === 'en' ? 'OFFICIAL' : '官方正式') : f.kind === 'thematic' ? (LANG === 'en' ? 'THEMATIC' : '主題協作') : (LANG === 'en' ? 'PENDING' : '規劃中')}</div>
      <div class="cardtitle">${ISL_BY_ID[f.from].icon} ${tr(ISL_BY_ID[f.from].name)} → ${ISL_BY_ID[f.to].icon} ${tr(ISL_BY_ID[f.to].name)}</div>
      <div class="cardsum">${tr(f.note)}</div>
      ${factTiles({
        facts: [
          { v: f.ev, u: { zh: '級', en: '' }, k: { zh: '證據等級', en: 'evidence grade' } },
          { v: o.walkers.length || FLOW_WALK_COUNT[f.kind], u: { zh: '人', en: '' }, k: { zh: '沿線人數', en: 'carriers' } },
          { v: o.total.toFixed(0), u: { zh: 'm', en: 'm' }, k: { zh: '路網距離', en: 'route length' } }
        ]
      })}
      <div class="eyebrow" style="margin-top:10px">${LANG === 'en' ? 'CARRYING' : '搬運物'}</div>
      <div style="margin-top:6px"><span class="chip">${tr(f.carry)}</span></div>`;
  } else if (kind === 'walker') {
    const w = WALKERS.find(x => x.id === id);
    const f = FLOW_OBJ[w.flow].def;
    const R = ROLES[w.role];
    const roleName = { civil: '公務員', resident: '居民', elder: '長者', student: '學童', parent: '家長', commuter: '通勤族', farmer: '農夫', worker: '工人', researcher: '研究員', traveller: '旅客' };
    cardBody.innerHTML = `
      <div class="eyebrow">${LANG === 'en' ? 'CARRIER' : '搬運者'}</div>
      <div class="cardtitle">${LANG === 'en' ? (w.role) : roleName[w.role]}</div>
      <div class="cardsum">${tr(f.carry)} · ${ISL_BY_ID[f.from].icon} ${tr(ISL_BY_ID[f.from].name)} → ${ISL_BY_ID[f.to].icon} ${tr(ISL_BY_ID[f.to].name)}</div>
      ${factTiles({
        facts: [
          { v: w.speed.toFixed(2), u: { zh: 'u/s', en: 'u/s' }, k: { zh: '移動速度', en: 'speed' } },
          { v: (w.t * 100).toFixed(0), u: { zh: '%', en: '%' }, k: { zh: '進度', en: 'progress' } },
          { v: w.pause > 0 ? '1.4' : '0', u: { zh: 's', en: 's' }, k: { zh: '交接等待', en: 'handoff wait' } }
        ]
      })}`;
  }
  cardBody.querySelectorAll('[data-item]').forEach(el => el.onclick = () => select('item', el.dataset.item));
  cardBody.querySelectorAll('[data-flow]').forEach(el => el.onclick = () => select('flow', el.dataset.flow));
  card.scrollTop = 0;
  updateLabels();
}
document.getElementById('cardClose').onclick = () => select(null, null);

/* ---------- sidebar ---------- */
function renderSidebar() {
  const tt = document.getElementById('tabThemes'), tf = document.getElementById('tabFlows');
  tt.innerHTML = ISLANDS.map(I => {
    const ids = Object.keys(ITEMS).filter(k => ITEMS[k].isl === I.id);
    return `<details class="isl" data-island="${I.id}"><summary><span class="no">${I.no}</span>${I.icon} ${tr(I.name)}</summary>
      ${ids.map(k => `<div class="itrow" data-item="${k}"><span class="pin1">${['①', '②', '③', '④', '⑤', '⑥'][ITEMS[k].no - 1]}</span> ${tr(ITEMS[k].name)}</div>`).join('')}
    </details>`;
  }).join('');
  tf.innerHTML = FLOWS.map(f => `<div class="flrow" data-flow="${f.id}">
      <span class="kdot ${f.kind}"></span>
      <span>${ISL_BY_ID[f.from].icon} ${tr(ISL_BY_ID[f.from].name)} → ${ISL_BY_ID[f.to].icon} ${tr(ISL_BY_ID[f.to].name)}</span>
      <span style="margin-left:auto;color:#6b5c50">${tr(f.carry)}</span>
    </div>`).join('');
  tt.querySelectorAll('[data-item]').forEach(el => el.onclick = (e) => { e.stopPropagation(); select('item', el.dataset.item); });
  tt.querySelectorAll('summary').forEach(el => el.onclick = () => { const id = el.parentElement.dataset.island; setTimeout(() => select('island', id), 0); });
  tf.querySelectorAll('[data-flow]').forEach(el => el.onclick = () => select('flow', el.dataset.flow));
  applySearch();
}
document.getElementById('q').addEventListener('input', applySearch);
function applySearch() {
  const q = (document.getElementById('q').value || '').trim().toLowerCase();
  document.querySelectorAll('#tabThemes details.isl').forEach(d => {
    const I = ISL_BY_ID[d.dataset.island];
    let vis = !q;
    if (q) {
      const hay = (I.no + ' ' + I.name.zh + ' ' + I.name.en + ' ' + I.id).toLowerCase();
      vis = hay.includes(q);
      d.querySelectorAll('.itrow').forEach(r => {
        const it = ITEMS[r.dataset.item];
        const h2 = (it.name.zh + ' ' + it.name.en).toLowerCase();
        const ok = h2.includes(q);
        r.style.display = ok ? '' : 'none';
        if (ok) vis = true;
      });
      if (vis) d.open = true;
    }
    d.style.display = vis ? '' : 'none';
  });
  document.querySelectorAll('#tabFlows .flrow').forEach(r => {
    const f = FLOW_OBJ[r.dataset.flow].def;
    const h = (f.carry.zh + ' ' + f.carry.en + ' ' + ISL_BY_ID[f.from].name.zh + ' ' + ISL_BY_ID[f.to].name.zh).toLowerCase();
    r.style.display = (!q || h.includes(q)) ? '' : 'none';
  });
}
document.getElementById('tabT').onclick = () => {
  document.getElementById('tabT').classList.add('on'); document.getElementById('tabF').classList.remove('on');
  document.getElementById('tabThemes').hidden = false; document.getElementById('tabFlows').hidden = true;
};
document.getElementById('tabF').onclick = () => {
  document.getElementById('tabF').classList.add('on'); document.getElementById('tabT').classList.remove('on');
  document.getElementById('tabThemes').hidden = true; document.getElementById('tabFlows').hidden = false;
};

/* ---------- log ---------- */
const logList = document.getElementById('logList');
const logFilter = document.getElementById('logFilter');
logFilter.innerHTML = `<option value="">${LANG === 'en' ? 'All flows' : '全部協作線'}</option>` + FLOWS.map(f => `<option value="${f.id}">${ISL_BY_ID[f.from].name.zh}→${ISL_BY_ID[f.to].name.zh}</option>`).join('');
logFilter.onchange = renderLog;
function renderLog() {
  const f = logFilter.value;
  const rows = LOG_EVENTS.filter(e => !f || e.flowId === f).slice(0, 26);
  logList.innerHTML = rows.map(e => `<div class="logev"><span class="lt">${e.t}</span>${e.type === 'arrive' ? (LANG === 'en' ? 'arrived' : '到站') : e.type === 'handoff' ? (LANG === 'en' ? 'handoff' : '交接') : (LANG === 'en' ? 'departed' : '出發')} · ${e.txt}</div>`).join('');
}

/* ---------- HUD ---------- */
document.querySelectorAll('#hud .tbtn[data-min]').forEach(b => {
  b.onclick = () => { Clock.minutes = +b.dataset.min; updateDayCycle(0); refreshHighlight(); STATE.dirty = true; };
});
function bindToggle(id, key, after) {
  const b = document.getElementById(id);
  b.onclick = () => {
    TOGGLES[key] = !TOGGLES[key];
    b.classList.toggle('on', TOGGLES[key]);
    if (after) after();
    refreshFlowVisibility();
    STATE.dirty = true;
  };
}
bindToggle('tglName', 'names');
bindToggle('tglCarry', 'carry');
bindToggle('tglFlow', 'flows');
bindToggle('tglPause', 'pause', () => { Clock.paused = TOGGLES.pause; });
bindToggle('tglTop', 'top', () => {
  if (TOGGLES.top) flyTo(new THREE.Vector3(0, 1, 0), 0.01, 58);
  else flyTo(new THREE.Vector3(0, 7, 0), 46, 22);
});
bindToggle('tglLog', 'log', () => { document.getElementById('logPanel').classList.toggle('hidden', !TOGGLES.log); });
document.getElementById('hudTimeBtn').onclick = () => document.getElementById('hud').classList.toggle('open');

document.getElementById('btnHome').onclick = () => { select(null, null); flyTo(new THREE.Vector3(0, 1, 0), 44, 26); };
document.getElementById('btnList').onclick = () => document.getElementById('side').classList.toggle('hidden');
document.getElementById('btnHelp').onclick = () => { document.getElementById('intro').hidden = false; };

/* ---------- intro ---------- */
const INTRO_KEY = 'policyIslandsIntroSeen';
function showIntro(force) {
  if (!force && localStorage.getItem(INTRO_KEY)) return;
  document.getElementById('intro').hidden = false;
}
document.getElementById('introGo').onclick = () => { document.getElementById('intro').hidden = true; localStorage.setItem(INTRO_KEY, '1'); };

/* ---------- keyboard ---------- */
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { select(null, null); document.getElementById('intro').hidden = true; }
  const step = 0.09;
  const d = new THREE.Vector3().subVectors(camera.position, controls.target);
  const sph = new THREE.Spherical().setFromVector3(d);
  if (e.key === 'ArrowLeft') sph.theta -= step;
  else if (e.key === 'ArrowRight') sph.theta += step;
  else if (e.key === 'ArrowUp') sph.phi = Math.max(0.16, sph.phi - step * 0.7);
  else if (e.key === 'ArrowDown') sph.phi = Math.min(Math.PI * 0.487, sph.phi + step * 0.7);
  else return;
  e.preventDefault();
  camera.position.setFromSpherical(sph).add(controls.target);
  STATE.dirty = true;
});

/* ---------- i18n ---------- */
function applyI18n() {
  document.querySelectorAll('[data-en]').forEach(el => {
    if (LANG === 'en') {
      if (!el.dataset.zh) el.dataset.zh = el.innerHTML;
      el.innerHTML = el.dataset.en;
    } else if (el.dataset.zh) {
      el.innerHTML = el.dataset.zh;
    }
  });
  const q = document.getElementById('q');
  q.placeholder = LANG === 'en' ? 'Search policies / items / flows...' : '搜尋政策／細項／協作…';
  document.title = LANG === 'en' ? 'Policy Islands' : '政策島 Policy Islands';
  for (const I of ISLANDS) {
    const L = ISL_MESH[I.id].label;
    if (L) L.el.textContent = I.no + ' ' + tr(I.name);
  }
  renderSidebar();
}

/* ---------- mobile bottom sheets ---------- */
function makeSheet(el, handle, initialH) {
  let dragging = false, startY = 0, startH = 0;
  const setH = (px) => { el.style.height = Math.min(window.innerHeight * 0.92, Math.max(px, 160)) + 'px'; };
  handle.addEventListener('pointerdown', (e) => {
    dragging = true; startY = e.clientY; startH = el.getBoundingClientRect().height;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    setH(startH - (e.clientY - startY));
  });
  handle.addEventListener('pointerup', (e) => {
    dragging = false;
    const h = el.getBoundingClientRect().height;
    if (h > window.innerHeight * 0.86) setH(window.innerHeight * 0.92);
  });
  handle.addEventListener('click', () => {
    const h = el.getBoundingClientRect().height;
    if (h > window.innerHeight * 0.86) setH(initialH);
  });
}
function setupSheets() {
  const mobile = window.innerWidth <= 800;
  const side = document.getElementById('side'), card = document.getElementById('card');
  if (mobile) {
    side.style.height = (window.innerHeight * 0.52) + 'px';
    card.style.height = (window.innerHeight * 0.34) + 'px';
  } else {
    side.style.height = ''; card.style.height = '';
  }
}
makeSheet(document.getElementById('side'), document.getElementById('sideHandle'), window.innerHeight * 0.52);
makeSheet(document.getElementById('card'), document.getElementById('cardHandle'), window.innerHeight * 0.34);
