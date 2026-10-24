/* ============ 05 · walkers, flows, badges ============ */
const WALK_SCALE = 2.45;                 // 小人本地高度 0.35 → 世界高度 ≈ 0.86
const WALK_H = 0.35;
const FLOW_R = 0.035 * WALK_SCALE;

/* ---------- Dijkstra over road graph ---------- */
function shortestPath(a, b) {
  const N = GRAPH.nodes.length;
  const dist = new Array(N).fill(Infinity), prev = new Array(N).fill(-1), done = new Array(N).fill(false);
  dist[a] = 0;
  for (let it = 0; it < N; it++) {
    let u = -1;
    for (let i = 0; i < N; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity) break;
    if (u === b) break;
    done[u] = true;
    for (const [x, y, w] of GRAPH.edges) {
      let v = -1;
      if (x === u) v = y; else if (y === u) v = x;
      if (v < 0) continue;
      if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; }
    }
  }
  const path = [];
  let cur = b;
  while (cur >= 0) { path.unshift(cur); if (cur === a) break; cur = prev[cur]; }
  return path[0] === a ? path : [a, b];
}

/* ---------- flow paths ---------- */
const FLOW_OBJ = {};
for (const f of FLOWS) {
  const A = ISL_NODES[f.from], C = ISL_NODES[f.to];
  const nodePath = shortestPath(A.center, C.center);
  const pts = nodePath.map(i => GRAPH.nodes[i].clone());
  // 累積長度
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = cum[cum.length - 1] || 1;
  FLOW_OBJ[f.id] = { def: f, pts, cum, total, tube: null, walkers: [] };
}

/* ---------- flow tube shader ---------- */
const flowMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  uniforms: { uTime: { value: 0 }, uLen: { value: 1 }, uStyle: { value: 0 }, uColor: { value: new THREE.Color(PAL.coral) }, uOpacity: { value: 0.82 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader: `
    uniform float uTime, uLen, uStyle, uOpacity; uniform vec3 uColor; varying vec2 vUv;
    void main(){
      float u = vUv.x * uLen * 5.0 - uTime * 1.4;
      float f = fract(u);
      if(uStyle > 0.5 && uStyle < 1.5){ if(f > 0.6) discard; }
      else if(uStyle >= 1.5){ if(f > 0.3) discard; }
      gl_FragColor = vec4(uColor, uOpacity);
    }`
});
// 建立單一條 flow 嘅 tube（初始 + 動態加 flow 共用；新島連路都要有）
function buildFlowTube(f) {
  const o = FLOW_OBJ[f.id];
  if (!o) return;
  if (o.tube) { scene.remove(o.tube); o.tube = null; }   // 重建時先移除舊 tube
  const curve = new THREE.CatmullRomCurve3(o.pts, false, 'catmullrom', 0.08);
  const geo = new THREE.TubeGeometry(curve, Math.max(24, o.pts.length * 12), FLOW_R, 6, false);
  const mat = flowMat.clone();
  mat.uniforms.uLen.value = o.total;
  mat.uniforms.uStyle.value = f.kind === 'official' ? 0 : (f.kind === 'thematic' ? 1 : 2);
  const tube = new THREE.Mesh(geo, mat);
  tube.visible = false;
  tube.userData = { pick: 'flow', id: f.id };
  tube.renderOrder = 3;
  scene.add(tube);
  o.tube = tube;
  o.curve = curve;
}
for (const f of FLOWS) buildFlowTube(f);

// 動態加 flow（09-net handleMutation / 10-gameplay autoLink）→ 建 FLOW_OBJ + tube
window.__addFlow = function (f) {
  if (FLOW_OBJ[f.id]) return false;
  const A = ISL_NODES[f.from], C = ISL_NODES[f.to];
  if (!A || !C) return false;
  const nodePath = shortestPath(A.center, C.center);
  const pts = nodePath.map(i => GRAPH.nodes[i].clone());
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = cum[cum.length - 1] || 1;
  FLOW_OBJ[f.id] = { def: f, pts, cum, total, tube: null, walkers: [] };
  buildFlowTube(f);
  return true;
};

/* ---------- walker parts (instanced, dynamic) ---------- */
const walkerGeo = {
  leg: new THREE.BoxGeometry(0.035, 0.16, 0.035),
  arm: new THREE.BoxGeometry(0.028, 0.13, 0.028),
  body: new THREE.CapsuleGeometry(0.055, 0.10, 4, 10),
  head: new THREE.SphereGeometry(0.07, 14, 12),
  hair: new THREE.SphereGeometry(0.072, 14, 8, 0, TAU, 0, Math.PI / 2),
  eye: new THREE.SphereGeometry(0.012, 6, 6),
  shadow: new THREE.CircleGeometry(0.085, 12)
};
const walkerMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, flatShading: false });
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x211d1d, transparent: true, opacity: 0.22, depthWrite: false });

/* accessory merged geometries */
function merged(parts) {
  const gs = parts.map(p => {
    let g = p.geo;
    if (p.x || p.y || p.z) g = g.clone();
    if (g.index) g = g.toNonIndexed();
    g.translate(p.x || 0, p.y || 0, p.z || 0);
    return g;
  });
  return mergeGeometries(gs, false);
}
const accGeo = {
  vest: merged([{ geo: new THREE.BoxGeometry(0.135, 0.115, 0.105) }]),
  badge: merged([{ geo: new THREE.BoxGeometry(0.03, 0.04, 0.012), z: 0.058, y: 0.01 }]),
  coat: merged([{ geo: new THREE.CapsuleGeometry(0.062, 0.11, 4, 10) }]),
  cane: merged([{ geo: new THREE.CylinderGeometry(0.010, 0.010, 0.22) }]),
  hat: merged([{ geo: new THREE.ConeGeometry(0.055, 0.05, 10) }]),
  helmet: merged([{ geo: new THREE.SphereGeometry(0.076, 12, 8, 0, TAU, 0, Math.PI / 2) }]),
  straw: merged([{ geo: new THREE.ConeGeometry(0.11, 0.05, 12) }]),
  stroller: merged([
    { geo: new THREE.BoxGeometry(0.16, 0.09, 0.12) },
    { geo: new THREE.TorusGeometry(0.035, 0.010, 6, 10), x: -0.06, y: -0.07 },
    { geo: new THREE.TorusGeometry(0.035, 0.010, 6, 10), x: 0.06, y: -0.07 }
  ]),
  bike: merged([
    { geo: new THREE.TorusGeometry(0.055, 0.010, 6, 12), x: -0.075, y: -0.075 },
    { geo: new THREE.TorusGeometry(0.055, 0.010, 6, 12), x: 0.075, y: -0.075 },
    { geo: new THREE.BoxGeometry(0.13, 0.014, 0.014), y: -0.06 }
  ]),
  case: merged([{ geo: new THREE.BoxGeometry(0.075, 0.09, 0.035) }]),
  apron: merged([{ geo: new THREE.BoxGeometry(0.13, 0.14, 0.02), y: 0.02 }]),
  cap: merged([
    { geo: new THREE.CylinderGeometry(0.055, 0.058, 0.035, 10) },
    { geo: new THREE.CylinderGeometry(0.062, 0.062, 0.015, 10), y: 0.018 }
  ]),
  bag: merged([
    { geo: new THREE.BoxGeometry(0.08, 0.11, 0.05), x: 0.06, y: -0.02 },
    { geo: new THREE.TorusGeometry(0.022, 0.008, 6, 10), x: 0.06, y: 0.045 }
  ])
};
const ACC_ORDER = ['vest', 'badge', 'coat', 'cane', 'hat', 'helmet', 'straw', 'stroller', 'bike', 'case', 'apron', 'cap', 'bag'];

/* ---------- roles ---------- */
const ROLES = {
  civil: { body: 0x6f7fb5, hair: 0x3a3330, acc: ['vest', 'badge'] },
  resident: { body: 0xdb6a41, hair: 0x2b2320, acc: [] },
  elder: { body: 0xc5b5a7, hair: 0xcfcfcf, acc: ['cane'] },
  student: { body: 0xfcea8b, hair: 0x2b2320, acc: ['hat'] },
  parent: { body: 0xf2b5c6, hair: 0x2b2320, acc: ['stroller'] },
  commuter: { body: 0x3e7c8c, hair: 0x2b2320, acc: ['bike'] },
  farmer: { body: 0x71806a, hair: 0x2b2320, acc: ['straw'] },
  worker: { body: 0xfcea8b, hair: 0x2b2320, acc: ['helmet'] },
  researcher: { body: 0xfff8f4, hair: 0x3a3330, acc: ['coat'] },
  traveller: { body: 0x58a6a6, hair: 0x3a3330, acc: ['case'] },
  /* 香港新角色 */
  waiter: { body: 0x4a7f8f, hair: 0x2b2320, acc: ['apron'] },
  trammer: { body: 0x2e6a42, hair: 0x2b2320, acc: ['cap'] },
  aunty: { body: 0xe89a9a, hair: 0x3a2a2a, acc: ['bag'] },
  cop: { body: 0x24304a, hair: 0x2b2320, acc: ['cap', 'badge'] },
  fireman: { body: 0xa83232, hair: 0x2b2320, acc: ['helmet'] },
  fisher: { body: 0x4f7f9f, hair: 0x2b2320, acc: ['straw', 'bag'] },
  hiker: { body: 0x6a8f4f, hair: 0x3a3330, acc: ['case', 'hat'] }
};
const ROLE_KEYS = Object.keys(ROLES);

/* ---------- build walker list ---------- */
const WALKERS = [];
const FLOW_WALK_COUNT = { official: 15, thematic: 9, pending: 5 };
for (const f of FLOWS) {
  const o = FLOW_OBJ[f.id];
  const n = FLOW_WALK_COUNT[f.kind] || 6;
  const pool = f.kind === 'official'
    ? ['civil', 'resident', 'elder', 'commuter', 'worker', 'cop', 'trammer', 'waiter']
    : (f.kind === 'thematic'
      ? ['researcher', 'student', 'parent', 'resident', 'hiker', 'fisher']
      : ['civil', 'traveller', 'resident', 'aunty', 'cop']);
  for (let i = 0; i < n; i++) {
    const role = pool[i % pool.length];
    WALKERS.push({
      id: 'w' + WALKERS.length, flow: f.id, role,
      t: (i / n) + RNG() * 0.04, dir: i % 2 ? 1 : -1,
      speed: 0.32 + RNG() * 0.08, phase: RNG(), pause: 0, x: 0, z: 0, yaw: 0,
      bike: ROLES[role].acc.includes('bike')
    });
  }
}
for (const w of WALKERS) {
  if (w.bike) w.speed = 0.62 + RNG() * 0.08;
}

/* ---------- instanced meshes for walker parts ---------- */
const WM = {};
const N = WALKERS.length;
function dynMesh(geo, mat, count) {
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.castShadow = false; m.receiveShadow = false;
  m.frustumCulled = false;
  return m;
}
WM.legL = dynMesh(walkerGeo.leg, walkerMat, N);
WM.legR = dynMesh(walkerGeo.leg, walkerMat, N);
WM.armL = dynMesh(walkerGeo.arm, walkerMat, N);
WM.armR = dynMesh(walkerGeo.arm, walkerMat, N);
WM.body = dynMesh(walkerGeo.body, walkerMat, N);
WM.head = dynMesh(walkerGeo.head, walkerMat, N);
WM.hair = dynMesh(walkerGeo.hair, walkerMat, N);
WM.eye = dynMesh(walkerGeo.eye, walkerMat, N * 2);
WM.shadow = dynMesh(walkerGeo.shadow, shadowMat, N);
WM.shadow.renderOrder = 1;
for (const k of ACC_ORDER) WM['acc_' + k] = dynMesh(accGeo[k], walkerMat, N);
for (const k in WM) {
  if (k === 'shadow') continue;
  WM[k].userData = { pick: 'walker' };
  scene.add(WM[k]);
}
scene.add(WM.shadow);

/* colours per walker part */
const tmpC = new THREE.Color();
WALKERS.forEach((w, i) => {
  const R = ROLES[w.role];
  tmpC.setHex(R.body); WM.body.setColorAt(i, tmpC);
  tmpC.setHex(R.hair); WM.hair.setColorAt(i, tmpC);
  tmpC.setHex(0xf0e6d8); WM.head.setColorAt(i, tmpC);
  tmpC.setHex(0x3a3330); WM.legL.setColorAt(i, tmpC); WM.legR.setColorAt(i, tmpC);
  tmpC.setHex(R.body); WM.armL.setColorAt(i, tmpC); WM.armR.setColorAt(i, tmpC);
  tmpC.setHex(0x241d1a); WM.eye.setColorAt(i * 2, tmpC); WM.eye.setColorAt(i * 2 + 1, tmpC);
  tmpC.setHex(0xffffff);
  for (const k of ACC_ORDER) {
    const a = R.acc.includes(k);
    if (k === 'vest') tmpC.setHex(a ? PAL.coral : 0xffffff);
    else if (k === 'badge') tmpC.setHex(a ? PAL.yellow : 0xffffff);
    else if (k === 'coat') tmpC.setHex(a ? 0xffffff : 0xffffff);
    else if (k === 'cane') tmpC.setHex(a ? 0x8a6b4a : 0xffffff);
    else if (k === 'hat') tmpC.setHex(a ? PAL.yellow : 0xffffff);
    else if (k === 'helmet') tmpC.setHex(a ? 0xfcea8b : 0xffffff);
    else if (k === 'straw') tmpC.setHex(a ? 0xd9c9a3 : 0xffffff);
    else if (k === 'stroller') tmpC.setHex(a ? PAL.teal : 0xffffff);
    else if (k === 'bike') tmpC.setHex(a ? 0x33302e : 0xffffff);
    else if (k === 'case') tmpC.setHex(a ? PAL.pastel[2] : 0xffffff);
    else if (k === 'apron') tmpC.setHex(a ? 0xe8e2d4 : 0xffffff);
    else if (k === 'cap') tmpC.setHex(a ? 0x24304a : 0xffffff);
    else if (k === 'bag') tmpC.setHex(a ? 0xb48560 : 0xffffff);
    WM['acc_' + k].setColorAt(i, tmpC);
  }
});
for (const k in WM) if (WM[k].instanceColor) WM[k].instanceColor.needsUpdate = true;

/* ---------- badge sprites (128² canvas) ---------- */
const badgeCache = {};
function badgeTexture(icon) {
  if (badgeCache[icon]) return badgeCache[icon];
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = '#fff8f4';
  g.beginPath(); g.arc(64, 64, 52, 0, TAU); g.fill();
  g.strokeStyle = '#db6a41'; g.lineWidth = 9;
  g.beginPath(); g.arc(64, 64, 48, 0, TAU); g.stroke();
  g.strokeStyle = '#211d1d'; g.lineWidth = 6; g.lineCap = 'round'; g.lineJoin = 'round';
  const ICON = {
    bus: () => { g.strokeRect(28, 34, 72, 44); g.beginPath(); g.moveTo(28, 60); g.lineTo(100, 60); g.stroke(); g.beginPath(); g.arc(44, 84, 7, 0, TAU); g.stroke(); g.beginPath(); g.arc(84, 84, 7, 0, TAU); g.stroke(); },
    cross: () => { g.beginPath(); g.moveTo(64, 26); g.lineTo(64, 102); g.moveTo(26, 64); g.lineTo(102, 64); g.stroke(); },
    building: () => { g.strokeRect(34, 30, 60, 68); for (let r = 0; r < 3; r++) for (let cc = 0; cc < 3; cc++) { g.strokeRect(42 + cc * 15, 40 + r * 16, 8, 8); } },
    home: () => { g.beginPath(); g.moveTo(24, 60); g.lineTo(64, 26); g.lineTo(104, 60); g.stroke(); g.strokeRect(40, 60, 48, 42); },
    coin: () => { g.beginPath(); g.arc(64, 64, 34, 0, TAU); g.stroke(); g.beginPath(); g.moveTo(64, 46); g.lineTo(64, 82); g.moveTo(52, 56); g.lineTo(76, 56); g.moveTo(52, 72); g.lineTo(76, 72); g.stroke(); },
    bike: () => { g.beginPath(); g.arc(38, 74, 20, 0, TAU); g.stroke(); g.beginPath(); g.arc(90, 74, 20, 0, TAU); g.stroke(); g.beginPath(); g.moveTo(38, 74); g.lineTo(60, 40); g.lineTo(90, 74); g.moveTo(60, 40); g.lineTo(80, 40); g.stroke(); },
    book: () => { g.strokeRect(26, 34, 76, 60); g.beginPath(); g.moveTo(64, 34); g.lineTo(64, 94); g.stroke(); },
    tree: () => { g.beginPath(); g.moveTo(64, 24); g.lineTo(38, 62); g.lineTo(90, 62); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(64, 62); g.lineTo(64, 100); g.stroke(); },
    heart: () => { g.beginPath(); g.moveTo(64, 96); g.bezierCurveTo(20, 66, 30, 32, 64, 48); g.bezierCurveTo(98, 32, 108, 66, 64, 96); g.stroke(); }
  };
  (ICON[icon] || ICON.box)();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  badgeCache[icon] = tex;
  return tex;
}
for (const w of WALKERS) {
  const f = FLOW_OBJ[w.flow].def;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: badgeTexture(f.icon), depthTest: true, transparent: true, opacity: 0.98 }));
  sp.scale.set(0.42, 0.42, 1);
  sp.visible = false;
  sp.userData = { pick: 'walker', id: w.id };
  scene.add(sp);
  w.badge = sp;
}

/* ---------- walker names (CSS2D) ---------- */
for (const w of WALKERS) {
  const f = FLOW_OBJ[w.flow].def;
  const el = document.createElement('div');
  el.className = 'wname';
  el.textContent = (LANG === 'en' ? 'Carrying ' : '正在搬 ') + tr(f.carry);
  el.style.display = 'none';
  const obj = new CSS2DObject(el);
  obj.visible = false;
  scene.add(obj);
  w.nameObj = obj;
}

/* ---------- walker update ---------- */
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();
function place(mesh, idx, x, y, z, yaw, rx, ry, rz, sx, sy, sz) {
  _e.set(rx || 0, ry !== undefined ? ry : yaw, rz || 0, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  _m4.compose(_p, _q, _s);
  mesh.setMatrixAt(idx, _m4);
}
function samplePath(o, t) {
  const d = clamp(t, 0, 1) * o.total;
  let i = 1;
  while (i < o.cum.length - 1 && o.cum[i] < d) i++;
  const a = o.pts[i - 1], b = o.pts[i];
  const seg = o.cum[i] - o.cum[i - 1] || 1;
  const k = clamp((d - o.cum[i - 1]) / seg, 0, 1);
  const x = lerp(a.x, b.x, k), z = lerp(a.z, b.z, k);
  const yaw = Math.atan2(b.x - a.x, b.z - a.z);
  return { x, z, yaw };
}
const LOG_EVENTS = [];
function logEvent(type, flowId, w) {
  const f = FLOW_OBJ[flowId].def;
  LOG_EVENTS.unshift({ type, flowId, t: Clock.label, icon: f.icon, txt: tr(f.carry), from: ISL_BY_ID[f.from], to: ISL_BY_ID[f.to] });
  if (LOG_EVENTS.length > 60) LOG_EVENTS.pop();
  renderLog();
}
function updateWalkers(dt, time) {
  const camPos = camera.position;
  for (let i = 0; i < WALKERS.length; i++) {
    const w = WALKERS[i];
    const o = FLOW_OBJ[w.flow];
    if (w.pause > 0) {
      w.pause -= dt;
      if (w.pause <= 0) { w.dir *= -1; logEvent('depart', w.flow, w); }
    } else {
      const prev = w.t;
      w.t += (w.dir * w.speed * dt) / o.total;
      if (w.t > 1) { w.t = 1; w.pause = 1.4; logEvent('arrive', w.flow, w); logEvent('handoff', w.flow, w); }
      else if (w.t < 0) { w.t = 0; w.pause = 1.4; logEvent('arrive', w.flow, w); logEvent('handoff', w.flow, w); }
    }
    const sp = samplePath(o, w.t);
    w.x = sp.x; w.z = sp.z; w.yaw = sp.yaw;
    const ph = time * 9 + w.phase * 20;
    const moving = w.pause <= 0;
    const swing = moving ? Math.sin(ph) : 0;
    const bob = moving ? Math.abs(Math.sin(ph)) * 0.012 : 0;
    const S = WALK_SCALE;
    const dcam = Math.hypot(camPos.x - sp.x, camPos.z - sp.z);
    const ds = clamp(dcam / 20, 1, 1.45);
    const s = S * ds;
    const base = ISL_TOP + 0.02;

    place(WM.legL, i, sp.x + Math.cos(sp.yaw) * 0.022 * s, base + (0.075 + bob) * s, sp.z - Math.sin(sp.yaw) * 0.022 * s, sp.yaw, swing * 0.55 * s, 0, 0, s, s, s);
    place(WM.legR, i, sp.x - Math.cos(sp.yaw) * 0.022 * s, base + (0.075 + bob) * s, sp.z + Math.sin(sp.yaw) * 0.022 * s, sp.yaw, -swing * 0.55 * s, 0, 0, s, s, s);
    place(WM.armL, i, sp.x + Math.cos(sp.yaw) * 0.062 * s, base + (0.225 + bob) * s, sp.z - Math.sin(sp.yaw) * 0.062 * s, sp.yaw, -swing * 0.45 * s, 0, 0, s, s, s);
    place(WM.armR, i, sp.x - Math.cos(sp.yaw) * 0.062 * s, base + (0.225 + bob) * s, sp.z + Math.sin(sp.yaw) * 0.062 * s, sp.yaw, swing * 0.45 * s, 0, 0, s, s, s);
    place(WM.body, i, sp.x, base + (0.205 + bob) * s, sp.z, sp.yaw, 0, 0, 0, s, s, s);
    place(WM.head, i, sp.x, base + (0.288 + bob) * s, sp.z, sp.yaw, 0, 0, 0, s, s, s);
    place(WM.hair, i, sp.x, base + (0.292 + bob) * s, sp.z, sp.yaw, 0, 0, 0, s, s, s);
    const fx = Math.sin(sp.yaw) * 0.058 * s, fz = Math.cos(sp.yaw) * 0.058 * s;
    const rx = Math.cos(sp.yaw) * 0.026 * s, rz = -Math.sin(sp.yaw) * 0.026 * s;
    place(WM.eye, i * 2, sp.x + rx + fx, base + (0.292 + bob) * s, sp.z + rz + fz, sp.yaw, 0, 0, 0, s, s, s);
    place(WM.eye, i * 2 + 1, sp.x - rx + fx, base + (0.292 + bob) * s, sp.z - rz + fz, sp.yaw, 0, 0, 0, s, s, s);
    place(WM.shadow, i, sp.x, base + 0.005, sp.z, 0, -Math.PI / 2, 0, 0, s * (1 - bob * 2), s * (1 - bob * 2), s * (1 - bob * 2));

    // accessories
    const R = ROLES[w.role];
    for (const k of ACC_ORDER) {
      const on = R.acc.includes(k);
      if (!on) { place(WM['acc_' + k], i, 0, -999, 0, 0, 0, 0, 0, 0.0001, 0.0001, 0.0001); continue; }
      let ax = 0, ay = 0, az = 0, ax2 = 0, ay2 = 0, az2 = 0, arx = 0, arz = 0;
      if (k === 'vest' || k === 'coat') { ay = 0.215; az = 0; }
      else if (k === 'badge') { ay = 0.225; az = 0.056; }
      else if (k === 'cane') { ax = 0.085; ay = 0.12; az = 0.01; arz = 0.12; }
      else if (k === 'hat') { ay = 0.335; }
      else if (k === 'helmet') { ay = 0.292; }
      else if (k === 'straw') { ay = 0.34; }
      else if (k === 'stroller') { ax = 0.14; ay = 0.10; }
      else if (k === 'bike') { ax = 0.0; ay = 0.075; }
      else if (k === 'case') { ax = -0.10; ay = 0.075; }
      const wx = sp.x + (Math.cos(sp.yaw) * ax + Math.sin(sp.yaw) * az) * s;
      const wz = sp.z + (-Math.sin(sp.yaw) * ax + Math.cos(sp.yaw) * az) * s;
      place(WM['acc_' + k], i, wx, base + ay * s, wz, sp.yaw, arx, 0, arz, s, s, s);
    }
    // badge + name
    const showBadge = (typeof TOGGLES !== 'undefined' && TOGGLES.carry) && dcam < 16;
    w.badge.visible = showBadge;
    if (showBadge) {
      w.badge.position.set(sp.x, base + (0.42 + bob) * s, sp.z);
      w.badge.scale.set(0.42 * ds, 0.42 * ds, 1);
    }
    const showName = (typeof TOGGLES !== 'undefined' && TOGGLES.names) && dcam < 14;
    w.nameObj.visible = showName;
    if (showName) w.nameObj.position.set(sp.x, base + (0.46 + bob) * s, sp.z);
  }
  for (const k in WM) WM[k].instanceMatrix.needsUpdate = true;
}
