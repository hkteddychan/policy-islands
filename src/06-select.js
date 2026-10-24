/* ============ 06 · labels, selection, highlight, camera flight ============ */
const TOGGLES = { names: false, carry: true, flows: false, pause: false, top: false, log: true };
const SEL = { kind: null, id: null };

/* ---------- island labels ---------- */
function createIslandLabel(I) {
  const isl = ISL_NODES[I.id];
  if (!isl) return;
  const el = document.createElement('div');
  el.className = 'ilabel';
  el.textContent = I.no + ' ' + tr(I.name);
  const obj = new CSS2DObject(el);
  const front = isl.base + Math.PI;   // 前側崖邊
  obj.position.set(isl.x + Math.sin(front) * (ISL_RAD + 0.9), ISL_TOP - 0.75, isl.z + Math.cos(front) * (ISL_RAD + 0.9));
  scene.add(obj);
  ISL_MESH[I.id].label = { obj, el };
}
ISLANDS.forEach(createIslandLabel);

/* ---------- item pins (①②③) ---------- */
const pinGroup = new THREE.Group();
scene.add(pinGroup);
const pinLines = [];
function clearPins() {
  while (pinGroup.children.length) {
    const c = pinGroup.children.pop();
    if (c.geometry) c.geometry.dispose();
  }
  pinLines.length = 0;
}
function buildPins(islandId) {
  clearPins();
  const ids = Object.keys(ITEMS).filter(id => ITEMS[id].isl === islandId);
  ids.forEach((id, idx) => {
    const it = ITEMS[id], w = ITEM_WORLD[id];
    const el = document.createElement('div');
    el.className = 'pinlab';
    el.textContent = ['①', '②', '③', '④', '⑤', '⑥'][idx] || String(idx + 1);
    const obj = new CSS2DObject(el);
    const top = new THREE.Vector3(w.pos.x, ISL_TOP + 1.55 * (w.scale / 2.5) + 0.35, w.pos.z);
    obj.position.copy(top).add(new THREE.Vector3(0, 0.25, 0));
    pinGroup.add(obj);
    // coral 細線 depthTest false
    const g = new THREE.BufferGeometry().setFromPoints([top, top.clone().add(new THREE.Vector3(0, 0.25, 0))]);
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: PAL.coral, depthTest: false, transparent: true, opacity: 0.95 }));
    line.renderOrder = 999;
    pinGroup.add(line);
    pinLines.push(line);
  });
}

/* ---------- highlight (tint via setColorAt) ---------- */
const TINT_CORAL = new THREE.Color(PAL.coral), TINT_YELLOW = new THREE.Color(PAL.yellow);
const mixC = new THREE.Color();
function itemActiveNow(id) {
  const it = ITEMS[id];
  const m = Clock.minutes;
  return m >= it.active[0] && m <= it.active[1];
}
function refreshHighlight() {
  // 重設所有顏色，再套用 highlight / dayCycle
  for (const kind in kitMeshes) {
    const mesh = kitMeshes[kind];
    const list = kitList[kind];
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      let c = rec.base;
      if (rec.item) {
        const isSel = SEL.kind === 'item' && SEL.id === rec.item;
        const islSel = SEL.kind === 'island' && ISL_BY_ID[ITEMS[rec.item].isl].id === SEL.id;
        if (isSel) c = mixC.copy(rec.base).lerp(TINT_CORAL, 0.22).clone();
        else if (islSel) c = mixC.copy(rec.base).lerp(TINT_CORAL, 0.10).clone();
        else if (itemActiveNow(rec.item)) c = mixC.copy(rec.base).lerp(TINT_YELLOW, 0.22).clone();
      }
      mesh.setColorAt(i, c);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

/* ---------- flow visibility ---------- */
function relatedFlows() {
  if (!SEL.kind) return [];
  if (SEL.kind === 'flow') return [SEL.id];
  if (SEL.kind === 'island') return FLOWS.filter(f => f.from === SEL.id || f.to === SEL.id).map(f => f.id);
  if (SEL.kind === 'item') {
    const isl = ITEMS[SEL.id].isl;
    return FLOWS.filter(f => f.from === isl || f.to === isl).map(f => f.id);
  }
  if (SEL.kind === 'walker') return [WALKERS.find(w => w.id === SEL.id)?.flow].filter(Boolean);
  return [];
}
function refreshFlowVisibility() {
  const rel = new Set(relatedFlows());
  let any = false;
  for (const f of FLOWS) {
    const o = FLOW_OBJ[f.id];
    const show = TOGGLES.flows || rel.has(f.id);
    o.tube.visible = show;
    if (show) any = true;
  }
  document.getElementById('legend').hidden = !any;
}

/* ---------- camera flight ---------- */
const flight = { active: false, t: 0, dur: 0.9, fromP: new THREE.Vector3(), toP: new THREE.Vector3(), fromT: new THREE.Vector3(), toT: new THREE.Vector3() };
function flyTo(target, dist, height) {
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target);
  dir.y = 0;
  if (dir.lengthSq() < 0.001) dir.set(0.4, 0, 1);
  dir.normalize();
  flight.fromP.copy(camera.position);
  flight.fromT.copy(controls.target);
  flight.toT.copy(target);
  flight.toP.copy(target).addScaledVector(dir, dist);
  flight.toP.y = target.y + height;
  flight.t = 0;
  flight.active = true;
  if (STATE.reduced) {
    camera.position.copy(flight.toP);
    controls.target.copy(flight.toT);
    flight.active = false;
    STATE.dirty = true;
  }
}
function updateFlight(dt) {
  if (!flight.active) return;
  flight.t = Math.min(1, flight.t + dt / flight.dur);
  const k = flight.t < 0.5 ? 2 * flight.t * flight.t : 1 - Math.pow(-2 * flight.t + 2, 2) / 2;
  camera.position.lerpVectors(flight.fromP, flight.toP, k);
  controls.target.lerpVectors(flight.fromT, flight.toT, k);
  STATE.dirty = true;
  if (flight.t >= 1) flight.active = false;
}

/* ---------- raycast selection ---------- */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downXY = null, downT = 0;
renderer.domElement.addEventListener('pointerdown', (e) => { downXY = [e.clientX, e.clientY]; downT = performance.now(); });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downXY) return;
  const dx = e.clientX - downXY[0], dy = e.clientY - downXY[1];
  const moved = Math.hypot(dx, dy);
  downXY = null;
  if (moved > 6 || performance.now() - downT > 700) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const targets = [];
  for (const kind in kitMeshes) targets.push(kitMeshes[kind]);
  for (const k in WM) targets.push(WM[k]);
  for (const f of FLOWS) { const o = FLOW_OBJ[f.id]; if (o.tube.visible) targets.push(o.tube); }
  scene.traverse(o => { if (o.isMesh && o.userData && o.userData.pick === 'island') targets.push(o); });
  const hits = raycaster.intersectObjects(targets, false);
  if (!hits.length) { select(null, null); return; }
  const hit = hits[0];
  const obj = hit.object;
  if (obj.userData.pick === 'island') { select('island', obj.userData.id); return; }
  if (obj.userData.pick === 'flow') { select('flow', obj.userData.id); return; }
  if (obj.userData.kind) {
    // 建物 instance → item
    const rec = kitList[obj.userData.kind][hit.instanceId];
    if (rec && rec.item) { select('item', rec.item); return; }
    select(null, null);
    return;
  }
  if (obj.userData.pick === 'walker') {
    // 找 walker index
    const idx = hit.instanceId;
    select('walker', WALKERS[idx] ? WALKERS[idx].id : null);
    return;
  }
  select(null, null);
});

/* ---------- select ---------- */
function select(kind, id) {
  // 擴充點：其他模組（10-gameplay.js）掛 window.__onSelect 嚟偵測選取變化。
  // 唔可以直接覆寫 window.select —— 呢個係 module scope function，
  // 內部呼叫（openCard 等）仍然指向原本，覆寫無效。
  if (typeof window.__onSelect === 'function') {
    try { window.__onSelect(kind, id); } catch (e) { console.warn('__onSelect', e); }
  }
  SEL.kind = kind; SEL.id = id;
  if (!kind) {
    clearPins();
    refreshHighlight();
    refreshFlowVisibility();
    document.getElementById('card').hidden = true;
    updateLabels();
    STATE.dirty = true;
    return;
  }
  if (kind === 'island') {
    buildPins(id);
    const isl = ISL_NODES[id];
    flyTo(new THREE.Vector3(isl.x, ISL_TOP + 1.2, isl.z), 22, 15);
  } else if (kind === 'item') {
    const w = ITEM_WORLD[id];
    flyTo(new THREE.Vector3(w.pos.x, ISL_TOP + 1.0, w.pos.z), 9, 7);
  } else if (kind === 'walker') {
    const w = WALKERS.find(x => x.id === id);
    if (w) flyTo(new THREE.Vector3(w.x, ISL_TOP + 0.6, w.z), 5.5, 3.4);
  } else if (kind === 'flow') {
    const o = FLOW_OBJ[id];
    const mid = o.pts[Math.floor(o.pts.length / 2)];
    flyTo(new THREE.Vector3(mid.x, ISL_TOP + 1.4, mid.z), 20, 15);
  }
  refreshHighlight();
  refreshFlowVisibility();
  openCard(kind, id);
  updateLabels();
  STATE.dirty = true;
}

/* ---------- label dim / collision avoidance ---------- */
const labelBoxes = [];
function updateLabels() {
  for (const I of ISLANDS) {
    const L = ISL_MESH[I.id] && ISL_MESH[I.id].label;
    if (!L || !L.el) continue;   // 新聞島 label 未建好都唔可以 crash
    const sel = SEL.kind === 'island' && SEL.id === I.id;
    L.el.classList.toggle('sel', sel);
    L.el.classList.toggle('dim', !!SEL.kind && !sel);
  }
  // 碰撞避讓
  const panels = ['brand', 'side', 'card', 'hud', 'logPanel'].map(id => document.getElementById(id)).filter(e => e && !e.hidden && e.offsetParent !== null);
  const panelRects = panels.map(p => p.getBoundingClientRect());
  labelBoxes.length = 0;
  const list = ISLANDS.map(I => (ISL_MESH[I.id] && ISL_MESH[I.id].label) || null).filter(Boolean);
  for (const L of list) {
    const r = L.el.getBoundingClientRect();
    if (!r.width) continue;
    let collide = false;
    for (const p of panelRects) if (r.left < p.right && r.right > p.left && r.top < p.bottom && r.bottom > p.top) { collide = true; break; }
    if (!collide) for (const b of labelBoxes) if (r.left < b.right + 8 && r.right > b.left - 8 && r.top < b.bottom + 8 && r.bottom > b.top - 8) { collide = true; break; }
    if (collide) {
      if (!L.el.classList.contains('mini')) { L.el.classList.add('mini'); STATE.dirty = true; }
    } else if (L.el.classList.contains('mini')) { L.el.classList.remove('mini'); STATE.dirty = true; }
    L.el.style.visibility = L.el.classList.contains('mini') ? 'visible' : 'visible';
    labelBoxes.push(r);
  }
  // 擴充點：11-vibe.js 掛熱度/priority 調整
  if (typeof window.__onLabels === 'function') { try { window.__onLabels(); } catch (e) {} }
}
