/* ============ 04 · instanced part kit + island construction ============ */
const ISL_TOP = 1.40;          // 島面高度
const ISL_RAD = 7.4;           // 六角島半徑
const RING_R = 5.8;            // 路網環半徑

/* ---------- geometry kinds ---------- */
const KITS = {
  box: { geo: new THREE.BoxGeometry(1, 1, 1), glow: false },
  rbox: { geo: new RoundedBoxGeometry(1, 1, 1, 2, 0.12), glow: false },
  cylinder: { geo: new THREE.CylinderGeometry(0.5, 0.5, 1, 14), glow: false },
  cone: { geo: new THREE.ConeGeometry(0.5, 1, 14), glow: false },
  sphere: { geo: new THREE.SphereGeometry(0.5, 16, 12), glow: false },
  ico: { geo: new THREE.IcosahedronGeometry(0.5, 1), glow: false },
  dome: { geo: new THREE.SphereGeometry(0.5, 16, 8, 0, TAU, 0, Math.PI / 2), glow: false },
  torus: { geo: new THREE.TorusGeometry(0.38, 0.12, 8, 18), glow: false },
  ring: { geo: new THREE.TorusGeometry(0.38, 0.03, 6, 28), glow: false },
  prism: { geo: new THREE.CylinderGeometry(0.5, 0.5, 1, 3), glow: false },
  hip: { geo: (() => { const g = new THREE.ConeGeometry(0.72, 1, 4); g.rotateY(Math.PI / 4); return g; })(), glow: false },
  glowbox: { geo: new THREE.BoxGeometry(1, 1, 1), glow: true },
  glowsphere: { geo: new THREE.SphereGeometry(0.5, 12, 10), glow: true }
};
const kitList = {};                       // kind -> [{m, color, item, island}]
for (const k in KITS) kitList[k] = [];

const MAT = {
  solid: new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0, flatShading: false }),
  glow: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0, emissive: new THREE.Color(0xffc777), emissiveIntensity: 0.05 })
};
const kitMeshes = {};                     // kind -> InstancedMesh

/* push a part in unit space; builder applies model→world transform */
function makeBuilder(origin, scale, rotY) {
  const base = new THREE.Matrix4().compose(
    origin,
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)),
    new THREE.Vector3(scale, scale, scale));
  return {
    push(kind, x, y, z, sx, sy, sz, color, rx = 0, ry = 0, rz = 0, item = null, island = null, small = false) {
      const j = 1 + (Math.random() * 2 - 1) * 0.0072;   // 防 z-fighting 抖動
      const local = new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
        new THREE.Vector3(sx * j, sy * j, sz * j));
      const world = base.clone().multiply(local);
      kitList[kind].push({ m: world, color: new THREE.Color(color), item, island, small, base: new THREE.Color(color) });
    }
  };
}

/* ---------- geometry helpers (unit space) ---------- */
function hipRoof(b, w, d, h, y, color, item, island) { b.push('hip', 0, y + h / 2, 0, w, h, d, color, 0, Math.PI / 4, 0, item, island); }
function win(b, x, y, z, w, h, d, item, island, rot = 0) { b.push('glowbox', x, y, z, w, h, d, PAL.win, 0, rot, 0, item, island); }

/* ---------- 12+ archetypes ---------- */
const ARCH = {};
ARCH.hall = (b, item, isl) => {
  b.push('rbox', 0, 0.34, 0, 1.0, 0.68, 0.92, PAL.wall, 0, 0, 0, item, isl);
  hipRoof(b, 1.12, 1.02, 0.34, 0.68, PAL.coral, item, isl);
  b.push('box', 0, 0.70, 0.47, 1.16, 0.09, 0.14, PAL.eave, 0, 0, 0, item, isl);
  win(b, -0.28, 0.40, 0.47, 0.22, 0.20, 0.05, item, isl);
  win(b, 0.28, 0.40, 0.47, 0.22, 0.20, 0.05, item, isl);
  b.push('rbox', 0.28, 0.30, -0.30, 0.26, 0.60, 0.26, PAL.stone, 0, 0, 0, item, isl);   // 鐘塔
  b.push('cone', 0.28, 0.72, -0.30, 0.34, 0.24, 0.34, PAL.eave, 0, 0, 0, item, isl);
  b.push('cylinder', 0.28, 0.63, -0.30, 0.16, 0.06, 0.16, PAL.cream, Math.PI / 2, 0, 0, item, isl);
  b.push('box', 0, 0.16, 0.47, 0.18, 0.32, 0.04, PAL.wood, 0, 0, 0, item, isl);         // 門
  b.push('cylinder', -0.42, 0.22, 0.42, 0.09, 0.44, 0.09, PAL.stone, 0, 0, 0, item, isl);
  b.push('sphere', -0.42, 0.48, 0.42, 0.16, 0.16, 0.16, PAL.plant[1], 0, 0, 0, item, isl);
};
ARCH.clock = (b, item, isl) => {
  b.push('cylinder', 0, 0.10, 0, 1.05, 0.20, 1.05, PAL.stone, 0, 0, 0, item, isl);
  b.push('rbox', 0, 0.52, 0, 0.44, 0.72, 0.40, PAL.cream, 0, 0, 0, item, isl);
  b.push('cylinder', 0, 0.92, 0, 0.60, 0.22, 0.60, PAL.coral, 0, 0, 0, item, isl);
  b.push('cone', 0, 1.12, 0, 0.44, 0.24, 0.44, PAL.eave, 0, 0, 0, item, isl);
  b.push('cylinder', 0, 0.62, 0.215, 0.34, 0.05, 0.34, PAL.cream, Math.PI / 2, 0, 0, item, isl);
  b.push('box', 0, 0.70, 0.245, 0.035, 0.14, 0.03, PAL.ink, 0, 0, 0, item, isl);
  b.push('box', 0.07, 0.62, 0.245, 0.11, 0.03, 0.03, PAL.ink, 0, 0, 0, item, isl);
  b.push('ring', 0, 0.62, 0.25, 0.48, 0.48, 0.48, PAL.metal, 0, 0, 0, item, isl);
  b.push('ring', 0, 0.52, 0, 0.62, 0.62, 0.62, PAL.metal, Math.PI / 2, 0, 0, item, isl);
};
ARCH.stage = (b, item, isl) => {
  b.push('rbox', 0, 0.09, 0, 1.0, 0.18, 0.78, PAL.wood, 0, 0, 0, item, isl);
  b.push('box', 0, 0.20, -0.34, 0.94, 0.04, 0.06, PAL.eave, 0, 0, 0, item, isl);
  for (const [x, z] of [[-0.44, -0.34], [0.44, -0.34], [-0.44, 0.32], [0.44, 0.32]])
    b.push('cylinder', x, 0.40, z, 0.07, 0.62, 0.07, PAL.stone, 0, 0, 0, item, isl);
  b.push('rbox', 0, 0.74, -0.01, 1.06, 0.09, 0.80, PAL.coral, 0, 0, 0, item, isl);
  b.push('box', 0, 0.48, -0.33, 0.88, 0.42, 0.05, PAL.pastel[0], 0, 0, 0, item, isl);
  b.push('glowsphere', -0.30, 0.62, 0.20, 0.11, 0.11, 0.11, PAL.yellow, 0, 0, 0, item, isl);
  b.push('glowsphere', 0.30, 0.62, 0.20, 0.11, 0.11, 0.11, PAL.yellow, 0, 0, 0, item, isl);
};
ARCH.busstop = (b, item, isl) => {
  b.push('rbox', -0.32, 0.26, 0, 0.42, 0.52, 0.34, PAL.glass, 0, 0, 0, item, isl);
  b.push('rbox', -0.32, 0.55, 0, 0.50, 0.06, 0.42, PAL.teal, 0, 0, 0, item, isl);
  b.push('cylinder', -0.50, 0.26, 0.16, 0.05, 0.52, 0.05, PAL.stone, 0, 0, 0, item, isl);
  b.push('cylinder', -0.14, 0.26, 0.16, 0.05, 0.52, 0.05, PAL.stone, 0, 0, 0, item, isl);
  b.push('box', -0.32, 0.13, 0.13, 0.34, 0.05, 0.12, PAL.wood, 0, 0, 0, item, isl);
  b.push('glowbox', -0.32, 0.26, 0.18, 0.34, 0.30, 0.03, PAL.glass, 0, 0, 0, item, isl);
  b.push('rbox', 0.34, 0.26, 0.02, 0.72, 0.34, 0.30, PAL.coral, 0, 0, 0, item, isl);  // 公車
  b.push('rbox', 0.34, 0.32, 0.02, 0.62, 0.14, 0.32, PAL.glass, 0, 0, 0, item, isl);
  b.push('rbox', 0.34, 0.44, 0.02, 0.70, 0.06, 0.28, PAL.cream, 0, 0, 0, item, isl);
  for (const [x, z] of [[0.10, 0.16], [0.58, 0.16], [0.10, -0.12], [0.58, -0.12]])
    b.push('cylinder', x, 0.07, z, 0.13, 0.07, 0.13, PAL.ink, Math.PI / 2, 0, 0, item, isl);
  b.push('box', 0.02, 0.28, 0.02, 0.10, 0.30, 0.24, PAL.cream, 0, 0, 0, item, isl);   // 站牌
};
ARCH.bike = (b, item, isl) => {
  for (const x of [-0.26, 0.26]) b.push('torus', x, 0.20, 0, 0.30, 0.30, 0.30, PAL.ink, 0, Math.PI / 2, 0, item, isl);
  b.push('box', 0, 0.22, 0, 0.56, 0.045, 0.045, PAL.coral, 0, 0, 0, item, isl);
  b.push('box', 0, 0.30, 0, 0.05, 0.20, 0.05, PAL.coral, 0, 0, 0, item, isl);
  b.push('box', 0.16, 0.36, 0, 0.20, 0.04, 0.04, PAL.ink, 0, 0, 0, item, isl);
  b.push('rbox', 0, 0.44, 0, 0.16, 0.07, 0.09, PAL.ink, 0, 0, 0, item, isl);
  for (const [x, z, c] of [[-0.36, 0.10, PAL.pastel[1]], [0.40, 0.12, PAL.pastel[2]], [-0.30, -0.12, PAL.yellow]]) {
    b.push('torus', x, 0.16, z, 0.26, 0.26, 0.26, c, 0, Math.PI / 2, 0, item, isl);
    b.push('box', x, 0.20, z, 0.30, 0.035, 0.035, PAL.ink, 0, 0, 0, item, isl);
  }
  b.push('box', 0, 0.03, 0, 0.94, 0.05, 0.06, PAL.stone, 0, 0, 0, item, isl);
};
ARCH.pavilion = (b, item, isl) => {
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU;
    b.push('cylinder', Math.sin(a) * 0.40, 0.30, Math.cos(a) * 0.40, 0.055, 0.60, 0.055, PAL.wood, 0, 0, 0, item, isl);
  }
  b.push('cone', 0, 0.74, 0, 0.95, 0.34, 0.95, PAL.eave, 0, 0, 0, item, isl);
  b.push('sphere', 0, 0.94, 0, 0.13, 0.13, 0.13, PAL.yellow, 0, 0, 0, item, isl);
  b.push('rbox', 0, 0.14, 0.28, 0.52, 0.05, 0.14, PAL.wood, 0, 0, 0, item, isl);
  b.push('cylinder', 0, 0.20, 0, 0.40, 0.06, 0.40, PAL.stone, 0, 0, 0, item, isl);
};
ARCH.classroom = (b, item, isl) => {
  b.push('rbox', 0, 0.05, 0, 1.02, 0.10, 0.86, PAL.stone, 0, 0, 0, item, isl);
  b.push('box', 0, 0.34, -0.40, 1.00, 0.50, 0.05, PAL.cream, 0, 0, 0, item, isl);
  b.push('box', 0, 0.40, -0.37, 0.66, 0.34, 0.03, PAL.ink, 0, 0, 0, item, isl);    // 黑板
  b.push('box', -0.48, 0.30, 0, 0.05, 0.44, 0.84, PAL.cream, 0, 0, 0, item, isl);
  b.push('box', 0.48, 0.30, 0, 0.05, 0.44, 0.84, PAL.cream, 0, 0, 0, item, isl);
  for (const [x, z] of [[-0.22, 0.10], [0.22, 0.10], [-0.22, -0.18], [0.22, -0.18]]) {
    b.push('rbox', x, 0.16, z, 0.26, 0.04, 0.18, PAL.wood, 0, 0, 0, item, isl);
    b.push('box', x, 0.10, z + 0.14, 0.10, 0.10, 0.10, PAL.ink, 0, 0, 0, item, isl);
    b.push('cylinder', x, 0.26, z - 0.02, 0.10, 0.16, 0.10, PAL.pastel[0], 0, 0, 0, item, isl);   // 迷你人
    b.push('sphere', x, 0.37, z - 0.02, 0.13, 0.13, 0.13, PAL.wall, 0, 0, 0, item, isl);
  }
};
ARCH.book = (b, item, isl) => {
  b.push('rbox', 0, 0.36, 0, 1.05, 0.66, 0.28, PAL.coral, 0, 0, 0, item, isl);
  b.push('rbox', 0, 0.36, 0.02, 0.94, 0.58, 0.24, PAL.cream, 0, 0, 0, item, isl);
  b.push('box', 0, 0.36, 0.16, 0.80, 0.05, 0.03, PAL.stone, 0, 0, 0, item, isl);
  b.push('box', 0, 0.36, 0.16, 0.05, 0.44, 0.03, PAL.stone, 0, 0, 0, item, isl);
  b.push('rbox', 0, 0.02, 0, 1.16, 0.05, 0.40, PAL.wood, 0, 0, 0, item, isl);
  b.push('box', 0, 0.685, 0.155, 1.02, 0.03, 0.03, PAL.metal, 0, 0, 0, item, isl);
  b.push('box', 0, 0.035, 0.155, 1.02, 0.03, 0.03, PAL.metal, 0, 0, 0, item, isl);
  b.push('box', -0.505, 0.36, 0.155, 0.03, 0.68, 0.03, PAL.metal, 0, 0, 0, item, isl);
  b.push('box', 0.505, 0.36, 0.155, 0.03, 0.68, 0.03, PAL.metal, 0, 0, 0, item, isl);
};
ARCH.globe = (b, item, isl) => {
  b.push('cylinder', 0, 0.06, 0, 0.72, 0.12, 0.72, PAL.stone, 0, 0, 0, item, isl);
  b.push('cylinder', 0, 0.24, 0, 0.14, 0.30, 0.14, PAL.wood, 0, 0, 0, item, isl);
  b.push('sphere', 0, 0.72, 0, 0.82, 0.82, 0.82, PAL.glass, 0, 0, 0, item, isl);
  b.push('torus', 0, 0.72, 0, 0.92, 0.92, 0.92, PAL.cream, 0, 0, 0, item, isl);
  b.push('torus', 0, 0.72, 0, 0.92, 0.92, 0.92, PAL.coral, 0, Math.PI / 2, 0, item, isl);
  b.push('ring', 0, 0.72, 0, 1.08, 1.08, 1.08, PAL.metal, 0, 0, 0, item, isl);
  b.push('ring', 0, 0.72, 0, 1.08, 1.08, 1.08, PAL.metal, Math.PI / 2, 0, 0, item, isl);
  b.push('sphere', 0.24, 0.86, 0.18, 0.26, 0.26, 0.26, PAL.plant[0], 0, 0, 0, item, isl);
};
ARCH.clinic = (b, item, isl) => {
  b.push('rbox', 0, 0.32, 0, 0.96, 0.64, 0.80, PAL.cream, 0, 0, 0, item, isl);
  hipRoof(b, 1.06, 0.90, 0.26, 0.64, PAL.teal, item, isl);
  win(b, -0.26, 0.40, 0.41, 0.22, 0.18, 0.05, item, isl);
  win(b, 0.26, 0.40, 0.41, 0.22, 0.18, 0.05, item, isl);
  b.push('box', 0, 0.16, 0.41, 0.20, 0.32, 0.04, PAL.teal, 0, 0, 0, item, isl);
  b.push('box', 0, 0.86, 0.30, 0.10, 0.30, 0.06, PAL.coral, 0, 0, 0, item, isl);   // 十字
  b.push('box', 0, 0.86, 0.30, 0.30, 0.10, 0.06, PAL.coral, 0, 0, 0, item, isl);
  b.push('rbox', -0.52, 0.20, -0.24, 0.28, 0.40, 0.24, PAL.glass, 0, 0, 0, item, isl);
  b.push('cylinder', 0.46, 0.30, -0.26, 0.05, 0.60, 0.05, PAL.stone, 0, 0, 0, item, isl);
  b.push('sphere', 0.46, 0.66, -0.26, 0.20, 0.20, 0.20, PAL.plant[2], 0, 0, 0, item, isl);
};
ARCH.cottage = (b, item, isl) => {
  b.push('rbox', 0, 0.30, 0, 0.92, 0.60, 0.80, PAL.wall, 0, 0, 0, item, isl);
  hipRoof(b, 1.04, 0.92, 0.32, 0.60, PAL.coral, item, isl);
  b.push('box', 0, 0.615, 0.43, 1.10, 0.07, 0.13, PAL.eave, 0, 0, 0, item, isl);
  win(b, -0.24, 0.34, 0.41, 0.22, 0.20, 0.05, item, isl);
  win(b, 0.24, 0.34, 0.41, 0.22, 0.20, 0.05, item, isl);
  b.push('box', 0, 0.15, 0.41, 0.18, 0.30, 0.04, PAL.wood, 0, 0, 0, item, isl);
  b.push('box', 0.28, 0.72, -0.16, 0.10, 0.28, 0.10, PAL.stone, 0, 0, 0, item, isl);
};
ARCH.court = (b, item, isl) => {
  b.push('rbox', 0, 0.04, 0, 1.02, 0.08, 0.76, PAL.teal, 0, 0, 0, item, isl);
  b.push('box', 0, 0.085, 0, 0.30, 0.02, 0.74, PAL.cream, 0, 0, 0, item, isl);
  for (const z of [-0.30, 0.30]) {
    b.push('cylinder', 0, 0.26, z, 0.05, 0.44, 0.05, PAL.stone, 0, 0, 0, item, isl);
    b.push('box', 0, 0.40, z, 0.34, 0.05, 0.05, PAL.coral, 0, 0, 0, item, isl);
    b.push('torus', 0, 0.36, z, 0.22, 0.22, 0.22, PAL.coral, Math.PI / 2, 0, 0, item, isl);
  }
  for (const [x, z] of [[-0.48, -0.36], [0.48, -0.36], [-0.48, 0.36], [0.48, 0.36]])
    b.push('cylinder', x, 0.18, z, 0.04, 0.28, 0.04, PAL.stone, 0, 0, 0, item, isl);
};
ARCH.farm = (b, item, isl) => {
  b.push('rbox', 0, 0.03, 0, 1.02, 0.06, 0.80, PAL.stone, 0, 0, 0, item, isl);
  for (let i = 0; i < 3; i++) {
    const z = -0.24 + i * 0.24;
    b.push('box', 0, 0.09, z, 0.92, 0.06, 0.14, 0x8a6b4a, 0, 0, 0, item, isl);
    for (let j = 0; j < 4; j++) {
      const x = -0.33 + j * 0.22;
      b.push('sphere', x, 0.16, z, 0.13, 0.13, 0.13, PAL.plant[i % 3], 0, 0, 0, item, isl);
    }
  }
  for (const x of [-0.48, 0.48]) for (const z of [-0.36, 0.36]) b.push('cylinder', x, 0.14, z, 0.04, 0.28, 0.04, PAL.wood, 0, 0, 0, item, isl);
  b.push('cylinder', 0.30, 0.28, 0.26, 0.05, 0.50, 0.05, PAL.wood, 0, 0, 0, item, isl);   // 稻草人
  b.push('cone', 0.30, 0.56, 0.26, 0.26, 0.14, 0.26, PAL.yellow, 0, 0, 0, item, isl);
};
ARCH.bridge = (b, item, isl) => {
  b.push('rbox', 0, 0.02, 0.12, 1.02, 0.05, 0.34, PAL.glass, 0, 0, 0, item, isl);   // 河道
  for (const z of [-0.28, -0.06, 0.16, 0.38]) b.push('box', 0, 0.055, z, 1.0, 0.02, 0.10, 0x7fb9c9, 0, 0, 0, item, isl);
  b.push('rbox', 0, 0.12, -0.30, 0.96, 0.06, 0.16, PAL.wood, 0, 0, 0, item, isl);  // 小橋
  for (const x of [-0.40, 0.40]) b.push('cylinder', x, 0.18, -0.30, 0.04, 0.14, 0.04, PAL.wood, 0, 0, 0, item, isl);
  b.push('box', 0, 0.22, -0.30, 0.90, 0.03, 0.03, PAL.eave, 0, 0, 0, item, isl);
  for (const x of [-0.44, 0.44]) { b.push('cylinder', x, 0.10, 0.34, 0.05, 0.20, 0.05, PAL.wood, 0, 0, 0, item, isl); b.push('sphere', x, 0.24, 0.34, 0.16, 0.16, 0.16, PAL.plant[0], 0, 0, 0, item, isl); }
};
ARCH.coin = (b, item, isl) => {
  b.push('cylinder', 0, 0.08, 0, 1.04, 0.16, 1.04, PAL.stone, 0, 0, 0, item, isl);
  b.push('cylinder', 0, 0.68, 0, 0.86, 0.24, 0.86, PAL.yellow, Math.PI / 2, 0, 0, item, isl);
  b.push('cylinder', 0, 0.68, 0.10, 0.60, 0.10, 0.60, PAL.cream, Math.PI / 2, 0, 0, item, isl);
  b.push('box', 0, 0.72, 0.16, 0.10, 0.36, 0.04, PAL.ink, 0, 0, 0, item, isl);
  b.push('box', 0, 0.80, 0.16, 0.30, 0.10, 0.04, PAL.ink, 0, 0, 0, item, isl);
  b.push('ring', 0, 0.68, 0, 1.14, 1.14, 1.14, PAL.metal, 0, 0, 0, item, isl);
};
ARCH.stall = (b, item, isl) => {
  b.push('rbox', 0, 0.16, 0, 0.90, 0.30, 0.50, PAL.wood, 0, 0, 0, item, isl);
  for (const x of [-0.42, 0.42]) for (const z of [-0.22, 0.22]) b.push('cylinder', x, 0.46, z, 0.05, 0.62, 0.05, PAL.wood, 0, 0, 0, item, isl);
  b.push('rbox', 0, 0.80, 0, 1.02, 0.06, 0.62, PAL.coral, 0, 0, 0, item, isl);
  b.push('box', 0, 0.76, 0, 1.00, 0.05, 0.30, PAL.cream, 0, 0, 0, item, isl);
  for (let i = 0; i < 5; i++) b.push('sphere', -0.32 + i * 0.16, 0.36, 0.06, 0.14, 0.14, 0.14, PAL.pastel[i % 3], 0, 0, 0, item, isl);
  b.push('cone', 0.36, 0.90, 0, 0.18, 0.16, 0.18, PAL.yellow, 0, 0, 0, item, isl);
};

/* ---------- 香港特殊建築系列（unit space：底面 ±0.5、高 0–1.5） ---------- */
const HK = {
  tramGreen: 0x2e6a42, tramDark: 0x16382a, starGreen: 0x1e6b4f,
  tongPink: 0xe8b4a0, tongTeal: 0x8fbfc9, tongCream: 0xf3e3b8,
  templeRed: 0x9e2f2f, gold: 0xd4af37, pawnGreen: 0x1e4d3b,
  estateGrey: 0xc8c4bc, jockeyBlue: 0x2e5fa3, cinemaPurple: 0x7b4f9e,
  neonPink: 0xff6f91, neonYellow: 0xffe066
};

/* 叮叮電車（雙層） */
ARCH.tram = (b, item, isl) => {
  b.push('rbox', 0, 0.08, 0, 1.55, 0.16, 0.80, HK.tramDark, 0, 0, 0, item, isl);          // 底盤
  for (const [x, z] of [[-0.55, 0.30], [0.55, 0.30], [-0.55, -0.30], [0.55, -0.30]])
    b.push('box', x, 0.025, z, 0.20, 0.12, 0.22, 0x111111, 0, 0, 0, item, isl);            // 車輪
  b.push('rbox', 0, 0.33, 0, 1.45, 0.34, 0.72, HK.tramGreen, 0, 0, 0, item, isl);          // 下層車身
  b.push('glowbox', 0, 0.38, 0.37, 1.30, 0.10, 0.04, PAL.win, 0, 0, 0, item, isl);          // 下層窗帶
  b.push('glowbox', 0, 0.44, -0.37, 1.30, 0.10, 0.04, PAL.win, 0, 0, 0, item, isl);
  b.push('rbox', 0, 0.62, 0, 1.35, 0.30, 0.66, HK.tramGreen, 0, 0, 0, item, isl);          // 上層車身
  b.push('glowbox', 0, 0.66, 0.34, 1.20, 0.10, 0.04, PAL.win, 0, 0, 0, item, isl);          // 上層窗帶
  b.push('glowbox', 0, 0.72, -0.34, 1.20, 0.10, 0.04, PAL.win, 0, 0, 0, item, isl);
  b.push('rbox', 0, 0.82, 0, 1.42, 0.08, 0.74, HK.tramDark, 0, 0, 0, item, isl);           // 車頂
  b.push('cylinder', 0, 0.92, 0, 0.05, 0.18, 0.05, 0x444444, 0, 0, 0, item, isl);           // 集電弓
  b.push('glowsphere', -0.68, 0.36, 0, 0.13, 0.13, 0.13, PAL.yellow, 0, 0, 0, item, isl);   // 頭燈
  b.push('glowsphere', 0.68, 0.36, 0, 0.13, 0.13, 0.13, PAL.yellow, 0, 0, 0, item, isl);
  b.push('box', -0.62, 0.66, 0, 0.08, 0.30, 0.10, HK.gold, 0, 0, 0, item, isl);             // 路線牌
};

/* 天星碼頭 */
ARCH.starferry = (b, item, isl) => {
  b.push('rbox', 0, 0.06, 0, 1.60, 0.12, 1.00, PAL.stone, 0, 0, 0, item, isl);             // 平台
  b.push('rbox', 0, 0.42, 0, 0.80, 0.60, 0.90, 0xe8e2d4, 0, 0, 0, item, isl);              // 主樓
  b.push('glowbox', 0, 0.50, 0.46, 0.60, 0.12, 0.04, PAL.win, 0, 0, 0, item, isl);          // 窗帶
  b.push('glowbox', 0, 0.60, 0.46, 0.60, 0.12, 0.04, PAL.win, 0, 0, 0, item, isl);
  b.push('rbox', 0, 0.82, 0, 0.96, 0.34, 1.04, HK.starGreen, 0, 0, 0, item, isl);           // 綠色塔樓
  b.push('hip', 0, 1.06, 0, 1.10, 0.26, 1.18, 0x14523c, 0, 0, 0, item, isl);                // 塔頂
  b.push('cylinder', 0, 1.26, 0, 0.10, 0.22, 0.10, 0x14523c, 0, 0, 0, item, isl);           // 鐘塔
  b.push('sphere', 0, 1.42, 0, 0.16, 0.16, 0.16, HK.gold, 0, 0, 0, item, isl);              // 塔尖金球
  b.push('glowsphere', 0, 0.92, 0.53, 0.12, 0.12, 0.12, PAL.night, 0, 0, 0, item, isl);     // 站名牌燈
  b.push('box', 0, 0.24, 0.51, 0.90, 0.10, 0.05, HK.starGreen, 0, 0, 0, item, isl);         // 站名橫匾
  b.push('rbox', -0.95, 0.20, 0, 0.10, 0.30, 0.85, PAL.wood, 0, 0, 0, item, isl);           // 登船橋欄
  b.push('rbox', 0.95, 0.20, 0, 0.10, 0.30, 0.85, PAL.wood, 0, 0, 0, item, isl);
};

/* 唐樓（連騎樓） */
ARCH.tonglau = (b, item, isl) => {
  b.push('rbox', 0, 0.28, 0, 1.20, 0.56, 1.05, HK.tongCream, 0, 0, 0, item, isl);          // 主樓
  for (let i = 0; i < 3; i++) {                                                            // 3 層窗
    const y = 0.16 + i * 0.20;
    b.push('glowbox', -0.34, y, 0.53, 0.26, 0.14, 0.04, PAL.win, 0, 0, 0, item, isl);
    b.push('glowbox', 0.34, y, 0.53, 0.26, 0.14, 0.04, PAL.win, 0, 0, 0, item, isl);
    b.push('glowbox', -0.34, y, -0.53, 0.26, 0.14, 0.04, PAL.win, 0, 0, 0, item, isl);
    b.push('glowbox', 0.34, y, -0.53, 0.26, 0.14, 0.04, PAL.win, 0, 0, 0, item, isl);
  }
  b.push('rbox', 0, 0.62, 0, 1.28, 0.10, 1.12, HK.tongPink, 0, 0, 0, item, isl);           // 簷篷（騎樓頂）
  b.push('rbox', 0, 0.10, 0.10, 1.18, 0.20, 0.20, PAL.stone, 0, 0, 0, item, isl);           // 騎樓底
  for (const x of [-0.42, 0, 0.42]) b.push('box', x, 0.24, 0.10, 0.10, 0.44, 0.10, 0xcfc6b8, 0, 0, 0, item, isl);  // 騎樓柱
  b.push('rbox', 0, 0.72, 0, 0.34, 0.14, 0.34, PAL.stone, 0, 0, 0, item, isl);             // 天台水缸
  b.push('box', 0, 0.86, 0.30, 0.50, 0.04, 0.04, 0x777777, 0, 0, 0, item, isl);            // 晾衫架
  b.push('box', -0.55, 0.40, 0, 0.06, 0.30, 0.06, HK.tongTeal, 0, 0, 0, item, isl);        // 外牆色條
  b.push('box', 0.55, 0.40, 0, 0.06, 0.30, 0.06, HK.tongPink, 0, 0, 0, item, isl);
};

/* 公屋高塔（井字型） */
ARCH.estate = (b, item, isl) => {
  b.push('rbox', 0, 0.78, 0, 1.05, 1.56, 1.05, HK.estateGrey, 0, 0, 0, item, isl);         // 主塔
  for (let i = 0; i < 8; i++) {                                                            // 層窗
    const y = 0.14 + i * 0.17;
    b.push('glowbox', 0, y, 0.53, 0.70, 0.08, 0.03, PAL.win, 0, 0, 0, item, isl);
    b.push('glowbox', 0, y, -0.53, 0.70, 0.08, 0.03, PAL.win, 0, 0, 0, item, isl);
  }
  for (const [x, z] of [[0.52, 0.52], [-0.52, 0.52], [0.52, -0.52], [-0.52, -0.52]]) {    // 井字四角欄杆
    b.push('box', x, 0.80, z, 0.16, 1.60, 0.16, 0x9a958d, 0, 0, 0, item, isl);
    b.push('glowbox', x, 0.85, z, 0.10, 0.30, 0.10, PAL.win, 0, 0, 0, item, isl);
  }
  b.push('rbox', 0, 1.60, 0, 1.16, 0.10, 1.16, 0x8b857c, 0, 0, 0, item, isl);              // 天台
  b.push('cylinder', 0.30, 1.76, 0.30, 0.16, 0.26, 0.16, 0x777777, 0, 0, 0, item, isl);    // 水缸
  b.push('cylinder', 0, 1.86, 0, 0.03, 0.30, 0.03, 0x555555, 0, 0, 0, item, isl);          // 天線
  b.push('rbox', 0, 0.06, 0.62, 1.10, 0.12, 0.30, PAL.teal, 0, 0, 0, item, isl);            // 入口雨棚
  b.push('box', 0, 0.14, 0.62, 0.70, 0.16, 0.06, 0x7a746c, 0, 0, 0, item, isl);            // 入口
};

/* 茶餐廳 */
ARCH.chaChaan = (b, item, isl) => {
  b.push('rbox', 0, 0.24, 0, 0.95, 0.48, 0.85, 0x3d6b8f, 0, 0, 0, item, isl);              // 藍色主體
  b.push('glowbox', 0, 0.30, 0.43, 0.60, 0.14, 0.04, PAL.win, 0, 0, 0, item, isl);
  b.push('rbox', 0, 0.52, 0, 1.05, 0.10, 0.95, 0x2f4f6e, 0, 0, 0, item, isl);              // 屋頂
  b.push('box', 0, 0.44, 0.52, 0.92, 0.08, 0.06, HK.neonPink, 0, 0, 0, item, isl);          // 霓虹招牌底
  b.push('glowbox', 0, 0.44, 0.55, 0.80, 0.06, 0.03, HK.neonPink, 0, 0, 0, item, isl);      // 霓虹光管
  b.push('glowbox', 0.30, 0.44, 0.55, 0.18, 0.06, 0.03, HK.neonYellow, 0, 0, 0, item, isl);
  b.push('box', 0, 0.12, 0.43, 0.70, 0.10, 0.06, PAL.wood, 0, 0, 0, item, isl);             // 卡位
  b.push('rbox', 0.30, 0.20, 0, 0.40, 0.05, 0.50, HK.tongCream, 0, 0, 0, item, isl);        // 枱
  b.push('cylinder', 0.30, 0.30, 0, 0.08, 0.22, 0.08, PAL.stone, 0, 0, 0, item, isl);       // 奶茶杯
  b.push('sphere', 0.30, 0.35, 0, 0.07, 0.05, 0.07, 0x7a5230, 0, 0, 0, item, isl);
  b.push('cylinder', 0, 0.30, -0.20, 0.05, 0.46, 0.05, PAL.wood, 0, 0, 0, item, isl);       // 吊扇柱
  b.push('torus', 0, 0.34, -0.20, 0.28, 0.28, 0.28, 0x8a8a8a, Math.PI / 2, 0, 0, item, isl);
};

/* 濕貨街市 */
ARCH.market = (b, item, isl) => {
  b.push('rbox', 0, 0.04, 0, 1.10, 0.08, 0.90, PAL.stone, 0, 0, 0, item, isl);             // 地面
  for (let i = 0; i < 3; i++) {
    const x = -0.34 + i * 0.34;
    b.push('rbox', x, 0.22, 0, 0.28, 0.30, 0.60, 0xdde3d0, 0, 0, 0, item, isl);            // 檔口
    b.push('box', x, 0.10, 0.30, 0.26, 0.04, 0.20, PAL.wood, 0, 0, 0, item, isl);           // 檯
    b.push('sphere', x - 0.08, 0.38, 0.10, 0.14, 0.14, 0.14, 0xea6b3a, 0, 0, 0, item, isl); // 番茄
    b.push('sphere', x + 0.08, 0.38, -0.10, 0.12, 0.12, 0.12, 0x8ab84f, 0, 0, 0, item, isl); // 菜
  }
  b.push('cone', 0, 0.42, 0, 1.30, 0.18, 1.10, HK.neonPink, 0, 0, 0, item, isl);            // 紅帳篷
  b.push('cone', 0, 0.46, 0, 1.16, 0.18, 0.96, 0xf5e9d0, 0, 0, 0, item, isl);              // 白帳篷
  b.push('glowsphere', -0.46, 0.18, 0.36, 0.10, 0.10, 0.10, PAL.night, 0, 0, 0, item, isl); // 吊燈
  b.push('glowsphere', 0.46, 0.18, 0.36, 0.10, 0.10, 0.10, PAL.night, 0, 0, 0, item, isl);
  b.push('glowsphere', 0, 0.18, -0.40, 0.10, 0.10, 0.10, PAL.night, 0, 0, 0, item, isl);
};

/* 文武廟（中式廟宇） */
ARCH.temple = (b, item, isl) => {
  b.push('rbox', 0, 0.06, 0, 1.20, 0.12, 1.00, PAL.stone, 0, 0, 0, item, isl);             // 平台
  b.push('rbox', 0, 0.40, 0, 0.95, 0.68, 0.90, HK.templeRed, 0, 0, 0, item, isl);          // 主殿
  b.push('glowbox', 0, 0.46, 0.46, 0.50, 0.14, 0.04, PAL.win, 0, 0, 0, item, isl);
  b.push('hip', 0, 0.82, 0, 1.35, 0.34, 1.30, 0x7a2020, 0, 0, 0, item, isl);               // 大歇山頂
  b.push('hip', 0, 1.02, 0, 0.85, 0.22, 0.80, 0x8e2a2a, 0, 0, 0, item, isl);               // 上層頂
  b.push('torus', -0.48, 0.92, 0.42, 0.10, 0.10, 0.10, HK.gold, 0, 0, 0, item, isl);        // 屋脊翹角
  b.push('torus', 0.48, 0.92, 0.42, 0.10, 0.10, 0.10, HK.gold, 0, 0, 0, item, isl);
  b.push('torus', -0.48, 0.92, -0.42, 0.10, 0.10, 0.10, HK.gold, 0, 0, 0, item, isl);
  b.push('torus', 0.48, 0.92, -0.42, 0.10, 0.10, 0.10, HK.gold, 0, 0, 0, item, isl);
  b.push('sphere', 0, 1.10, 0, 0.10, 0.10, 0.10, HK.gold, 0, 0, 0, item, isl);              // 寶頂
  b.push('box', 0, 0.20, 0.46, 0.34, 0.28, 0.05, 0x5e1616, 0, 0, 0, item, isl);            // 大門
  b.push('rbox', 0, 0.20, 0.55, 0.70, 0.06, 0.14, PAL.wood, 0, 0, 0, item, isl);            // 門檻
  b.push('cylinder', -0.55, 0.20, 0.40, 0.11, 0.22, 0.11, 0x9aa4a8, 0, 0, 0, item, isl);   // 石鼓
  b.push('cylinder', 0.55, 0.20, 0.40, 0.11, 0.22, 0.11, 0x9aa4a8, 0, 0, 0, item, isl);
  b.push('cylinder', 0, 0.10, -0.35, 0.18, 0.08, 0.18, PAL.stone, 0, 0, 0, item, isl);      // 香爐
  b.push('glowsphere', 0, 0.20, -0.35, 0.10, 0.10, 0.10, 0xff9d5c, 0, 0, 0, item, isl);    // 香火
  b.push('cylinder', -0.35, 0.55, 0, 0.03, 0.50, 0.03, 0x8a6b4a, 0, 0, 0, item, isl);      // 香柱
  b.push('cylinder', 0.35, 0.55, 0, 0.03, 0.50, 0.03, 0x8a6b4a, 0, 0, 0, item, isl);
  b.push('glowsphere', -0.35, 0.85, 0, 0.08, 0.08, 0.08, 0xffb066, 0, 0, 0, item, isl);    // 香火頭
  b.push('glowsphere', 0.35, 0.85, 0, 0.08, 0.08, 0.08, 0xffb066, 0, 0, 0, item, isl);
};

/* 當鋪（蝠鼠吊金錢） */
ARCH.pawnshop = (b, item, isl) => {
  b.push('rbox', 0, 0.30, 0, 0.95, 0.60, 0.85, HK.pawnGreen, 0, 0, 0, item, isl);          // 樓身
  b.push('glowbox', 0, 0.36, 0.43, 0.55, 0.12, 0.04, PAL.win, 0, 0, 0, item, isl);
  b.push('rbox', 0, 0.66, 0, 1.05, 0.12, 0.95, 0x153c2e, 0, 0, 0, item, isl);              // 屋頂
  b.push('box', 0, 0.56, 0.50, 0.88, 0.24, 0.08, 0x102e22, 0, 0, 0, item, isl);            // 大招牌
  b.push('torus', 0, 0.60, 0.55, 0.34, 0.34, 0.34, HK.gold, 0, 0, 0, item, isl);            // 金錢圓
  b.push('cylinder', 0, 0.60, 0.55, 0.14, 0.05, 0.14, HK.gold, 0, 0, 0, item, isl);         // 金錢內芯
  b.push('cone', -0.30, 0.72, 0.55, 0.22, 0.16, 0.12, 0x222222, 0, 0.6, 0, item, isl);      // 蝠翼
  b.push('cone', 0.30, 0.72, 0.55, 0.22, 0.16, 0.12, 0x222222, 0, -0.6, 0, item, isl);
  b.push('sphere', 0, 0.68, 0.55, 0.12, 0.12, 0.12, 0x222222, 0, 0, 0, item, isl);          // 蝠身
  b.push('glowbox', 0, 0.20, 0.43, 0.34, 0.26, 0.04, 0x3a2a10, 0, 0, 0, item, isl);        // 木閘
  b.push('glowsphere', -0.40, 0.40, 0, 0.10, 0.10, 0.10, HK.neonPink, 0, 0, 0, item, isl); // 霓虹燈
  b.push('glowsphere', 0.40, 0.40, 0, 0.10, 0.10, 0.10, HK.neonPink, 0, 0, 0, item, isl);
};

/* 金融天際線（中銀鋸齒風格） */
ARCH.skyscraper = (b, item, isl) => {
  b.push('rbox', 0, 0.72, 0, 0.85, 1.44, 0.85, 0xb9b6ae, 0, 0, 0, item, isl);              // 主塔
  for (let i = 0; i < 10; i++) {
    const y = 0.10 + i * 0.14;
    b.push('glowbox', 0, y, 0.43, 0.68, 0.05, 0.03, PAL.glass, 0, 0, 0, item, isl);
    b.push('glowbox', 0, y, -0.43, 0.68, 0.05, 0.03, PAL.glass, 0, 0, 0, item, isl);
  }
  for (const [x, z] of [[0.42, 0.42], [-0.42, 0.42], [0.42, -0.42], [-0.42, -0.42]]) {    // 四角鋸齒
    b.push('prism', x, 1.12, z, 0.34, 0.70, 0.34, 0x9a978e, 0, 0.4, 0, item, isl);
    b.push('glowbox', x, 1.16, z, 0.16, 0.12, 0.16, PAL.glass, 0, 0, 0, item, isl);
  }
  b.push('rbox', 0, 1.50, 0, 0.95, 0.12, 0.95, 0x8a8780, 0, 0, 0, item, isl);              // 頂層
  b.push('cylinder', 0, 1.70, 0, 0.035, 0.34, 0.035, 0x555555, 0, 0, 0, item, isl);         // 天線
  b.push('glowsphere', 0, 1.72, 0, 0.08, 0.08, 0.08, 0xff4444, 0, 0, 0, item, isl);         // 紅燈
  b.push('rbox', 0, 0.10, 0.50, 0.70, 0.12, 0.16, PAL.teal, 0, 0, 0, item, isl);            // 大堂
};

/* 舊戲院 */
ARCH.cinema = (b, item, isl) => {
  b.push('rbox', 0, 0.26, 0, 1.10, 0.52, 0.90, 0xd9d2c4, 0, 0, 0, item, isl);              // 主樓
  b.push('glowbox', 0, 0.34, 0.46, 0.70, 0.14, 0.04, PAL.win, 0, 0, 0, item, isl);
  b.push('rbox', 0, 0.60, 0, 1.20, 0.16, 1.00, HK.cinemaPurple, 0, 0, 0, item, isl);       // 屋頂橫條
  b.push('box', 0, 0.58, 0.54, 1.00, 0.12, 0.08, HK.neonPink, 0, 0, 0, item, isl);          // 巨型霓虹招牌
  b.push('glowbox', 0, 0.58, 0.57, 0.92, 0.07, 0.03, HK.neonPink, 0, 0, 0, item, isl);      // 光管
  b.push('glowbox', 0.32, 0.58, 0.57, 0.22, 0.07, 0.03, HK.neonYellow, 0, 0, 0, item, isl);
  b.push('cone', 0, 0.34, 0.55, 0.80, 0.10, 0.46, 0x8f2d3f, 0, 0, 0, item, isl);           // 入口帳篷
  b.push('cone', 0, 0.36, 0.55, 0.68, 0.10, 0.38, 0xf5e9d0, 0, 0, 0, item, isl);
  b.push('box', 0, 0.20, 0.60, 0.30, 0.26, 0.06, 0x5e1616, 0, 0, 0, item, isl);            // 大門
  b.push('glowsphere', -0.42, 0.30, 0.50, 0.09, 0.09, 0.09, PAL.night, 0, 0, 0, item, isl);
  b.push('glowsphere', 0.42, 0.30, 0.50, 0.09, 0.09, 0.09, PAL.night, 0, 0, 0, item, isl);
};

/* 馬會投注站 */
ARCH.jockey = (b, item, isl) => {
  b.push('rbox', 0, 0.22, 0, 0.95, 0.44, 0.80, HK.jockeyBlue, 0, 0, 0, item, isl);         // 主體
  b.push('glowbox', 0, 0.28, 0.41, 0.60, 0.12, 0.04, PAL.win, 0, 0, 0, item, isl);
  b.push('rbox', 0, 0.48, 0, 1.05, 0.08, 0.90, 0xf0f0f0, 0, 0, 0, item, isl);              // 白色楣
  b.push('rbox', 0, 0.54, 0, 1.10, 0.06, 0.96, HK.jockeyBlue, 0, 0, 0, item, isl);          // 藍色屋頂
  b.push('glowbox', 0, 0.44, 0.47, 0.80, 0.06, 0.04, 0xffffff, 0, 0, 0, item, isl);         // 招牌白字
  b.push('glowbox', 0.25, 0.44, 0.47, 0.30, 0.06, 0.04, HK.neonYellow, 0, 0, 0, item, isl);
  b.push('torus', 0.30, 0.24, 0, 0.20, 0.20, 0.20, 0x8f8f8f, 0, Math.PI / 2, 0, item, isl); // 馬蹄抽象
  b.push('box', 0.30, 0.14, 0, 0.16, 0.06, 0.06, PAL.wood, 0, 0, 0, item, isl);
  b.push('glowsphere', -0.40, 0.30, 0, 0.10, 0.10, 0.10, PAL.night, 0, 0, 0, item, isl);
  b.push('glowsphere', 0.40, 0.30, 0, 0.10, 0.10, 0.10, PAL.night, 0, 0, 0, item, isl);
};

/* 麻雀館 */
ARCH.mahjong = (b, item, isl) => {
  b.push('rbox', 0, 0.30, 0, 0.95, 0.60, 0.85, 0x5e2d33, 0, 0, 0, item, isl);              // 深紅樓身
  b.push('glowbox', 0, 0.36, 0.43, 0.55, 0.12, 0.04, PAL.win, 0, 0, 0, item, isl);
  b.push('rbox', 0, 0.66, 0, 1.05, 0.12, 0.95, 0x3e1d21, 0, 0, 0, item, isl);
  b.push('box', 0, 0.56, 0.50, 0.88, 0.22, 0.08, 0x2a1013, 0, 0, 0, item, isl);            // 大招牌
  b.push('glowbox', 0, 0.56, 0.53, 0.78, 0.08, 0.04, HK.neonPink, 0, 0, 0, item, isl);      // 霓虹
  b.push('glowbox', 0.22, 0.56, 0.53, 0.30, 0.08, 0.04, HK.neonYellow, 0, 0, 0, item, isl);
  for (let i = 0; i < 4; i++) {                                                            // 麻將粒
    const x = -0.24 + i * 0.16;
    b.push('rbox', x, 0.42, 0, 0.11, 0.14, 0.08, 0x1a5c3a, 0, 0, 0, item, isl);
    b.push('box', x, 0.42, 0, 0.07, 0.06, 0.045, 0xe8e8e8, 0, 0, 0, item, isl);
  }
  b.push('glowsphere', -0.40, 0.40, 0, 0.10, 0.10, 0.10, HK.neonPink, 0, 0, 0, item, isl);
  b.push('glowsphere', 0.40, 0.40, 0, 0.10, 0.10, 0.10, HK.neonYellow, 0, 0, 0, item, isl);
};

/* 九廣鐵路站亭 */
ARCH.kcr = (b, item, isl) => {
  b.push('rbox', 0, 0.14, 0, 1.10, 0.28, 0.55, PAL.stone, 0, 0, 0, item, isl);             // 月台
  b.push('rbox', 0, 0.46, 0, 0.80, 0.36, 0.60, 0x35685f, 0, 0, 0, item, isl);              // 站亭
  b.push('glowbox', 0, 0.52, 0.31, 0.55, 0.12, 0.04, PAL.win, 0, 0, 0, item, isl);
  b.push('hip', 0, 0.70, 0, 1.00, 0.22, 0.80, 0x2a534b, 0, 0, 0, item, isl);               // 金字頂
  b.push('cylinder', -0.50, 0.30, 0, 0.05, 0.34, 0.05, 0xf0f0f0, 0, 0, 0, item, isl);      // 白柱
  b.push('cylinder', 0.50, 0.30, 0, 0.05, 0.34, 0.05, 0xf0f0f0, 0, 0, 0, item, isl);
  b.push('box', 0, 0.60, 0.34, 0.60, 0.06, 0.05, 0xf0f0f0, 0, 0, 0, item, isl);            // 站名牌
  b.push('cylinder', 0.36, 0.84, 0, 0.06, 0.18, 0.06, 0x2a534b, 0, 0, 0, item, isl);       // 鐘樓
  b.push('cylinder', 0.36, 0.94, 0, 0.30, 0.05, 0.30, 0xf0f0f0, 0, 0, 0, item, isl);       // 鐘面
  b.push('glowsphere', -0.30, 0.30, 0, 0.08, 0.08, 0.08, PAL.night, 0, 0, 0, item, isl);
  b.push('glowsphere', 0.30, 0.30, 0, 0.08, 0.08, 0.08, PAL.night, 0, 0, 0, item, isl);
};

/* 燈塔（紅白） */
ARCH.lighthouse = (b, item, isl) => {
  b.push('cylinder', 0, 0.06, 0, 0.90, 0.12, 0.90, PAL.stone, 0, 0, 0, item, isl);         // 基座
  b.push('cylinder', 0, 0.60, 0, 0.34, 1.10, 0.34, 0xf0f0f0, 0, 0, 0, item, isl);          // 白塔
  b.push('cylinder', 0, 0.75, 0, 0.38, 0.22, 0.38, 0xc0392b, 0, 0, 0, item, isl);          // 紅帶
  b.push('cylinder', 0, 1.00, 0, 0.38, 0.20, 0.38, 0xc0392b, 0, 0, 0, item, isl);
  b.push('cylinder', 0, 1.24, 0, 0.44, 0.30, 0.44, 0x222222, 0, 0, 0, item, isl);          // 燈室
  b.push('glowsphere', 0, 1.28, 0, 0.22, 0.22, 0.22, PAL.night, 0, 0, 0, item, isl);        // 燈光
  b.push('cone', 0, 1.46, 0, 0.28, 0.16, 0.28, 0xc0392b, 0, 0, 0, item, isl);              // 塔頂
  b.push('rbox', 0, 0.14, 0.40, 0.70, 0.06, 0.16, PAL.wood, 0, 0, 0, item, isl);           // 望台欄
  b.push('cylinder', -0.55, 0.10, 0, 0.05, 0.18, 0.05, 0x555555, 0, 0, 0, item, isl);
  b.push('cylinder', 0.55, 0.10, 0, 0.05, 0.18, 0.05, 0x555555, 0, 0, 0, item, isl);
};

/* ---------- 樹種（每島不同） ---------- */
function treeSpecies(b, sp, x, y, z, s, item, isl) {
  const P = (k, px, py, pz, sx, sy, sz, c) => b.push(k, x + px * s, y + py * s, z + pz * s, sx * s, sy * s, sz * s, c, 0, 0, 0, item, isl);
  if (sp === 'pine') {
    P('cylinder', 0, 0.16, 0, 0.13, 0.32, 0.13, 0x8a6b4a);
    P('cone', 0, 0.44, 0, 0.72, 0.52, 0.72, PAL.plant[2]);
    P('cone', 0, 0.68, 0, 0.54, 0.40, 0.54, PAL.plant[1]);
  } else if (sp === 'cherry') {
    P('cylinder', 0, 0.18, 0, 0.14, 0.36, 0.14, 0x8a6b4a);
    P('sphere', 0, 0.48, 0, 0.66, 0.52, 0.66, 0xf2b5c6);
    P('sphere', 0.22, 0.36, 0.12, 0.34, 0.28, 0.34, 0xf7cad6);
  } else if (sp === 'fruit') {
    P('cylinder', 0, 0.16, 0, 0.15, 0.32, 0.15, 0x8a6b4a);
    P('sphere', 0, 0.46, 0, 0.70, 0.58, 0.70, PAL.plant[0]);
    P('sphere', 0.18, 0.34, 0.16, 0.22, 0.22, 0.22, 0xdb6a41);
    P('sphere', -0.20, 0.40, -0.10, 0.18, 0.18, 0.18, 0xfcea8b);
  } else if (sp === 'palm') {
    P('cylinder', 0, 0.34, 0, 0.12, 0.68, 0.12, 0xa8814f);
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * TAU;
      b.push('cone', x + Math.cos(a) * 0.26 * s, y + 0.70 * s, z + Math.sin(a) * 0.26 * s, 0.30 * s, 0.52 * s, 0.30 * s, PAL.plant[1], 0, a, 0, item, isl);
    }
    P('sphere', 0, 0.70, 0, 0.20, 0.18, 0.20, 0x8a6b4a);
  } else { // willow
    P('cylinder', 0, 0.22, 0, 0.14, 0.44, 0.14, 0x8a6b4a);
    P('sphere', 0, 0.56, 0, 0.72, 0.46, 0.72, PAL.plant[1]);
    P('cone', 0.22, 0.36, 0, 0.30, 0.42, 0.30, PAL.plant[0]);
    P('cone', -0.22, 0.36, 0, 0.30, 0.42, 0.30, PAL.plant[0]);
  }
}

/* ---------- islands ---------- */
const ISL_MESH = {};        // id -> {group, labelObj, nodes}
const GRAPH = { nodes: [], edges: [] };
const ISL_NODES = {};       // id -> {center: nodeIdx, ring: [6 nodeIdx]}

function addNode(x, y, z) { GRAPH.nodes.push(new THREE.Vector3(x, y, z)); return GRAPH.nodes.length - 1; }
function addEdge(a, b) {
  const d = GRAPH.nodes[a].distanceTo(GRAPH.nodes[b]);
  GRAPH.edges.push([a, b, d]);
}

const ISL_ORDER = ['transport', 'education', 'health', 'housing', 'environment', 'economy'];
const ISL_SPECIES = {
  hub: 'cherry', transport: 'willow', education: 'fruit', health: 'pine',
  housing: 'palm', environment: 'cherry', economy: 'fruit'
};

/* island platform + road ring */
function buildIsland(I) {
  const g = new THREE.Group();
  const pos = ISL_POS[I.id];
  const x = pos.x, z = pos.y;
  const isHub = I.id === 'hub';
  const rad = isHub ? ISL_RAD + 0.5 : ISL_RAD;
  // 崖體
  const cliff = new THREE.Mesh(
    new THREE.CylinderGeometry(rad, rad * 0.88, 3.2, 6),
    new THREE.MeshStandardMaterial({ color: isHub ? 0x9c8b7a : 0x8f8271, flatShading: true, roughness: 0.95 }));
  cliff.position.set(x, ISL_TOP - 1.6, z);
  cliff.rotation.y = Math.PI / 6;
  cliff.castShadow = true; cliff.receiveShadow = true;
  cliff.userData = { pick: 'island', id: I.id };
  g.add(cliff);
  // 島面
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(rad * 0.99, rad * 0.99, 0.34, 6),
    new THREE.MeshStandardMaterial({ color: I.color, flatShading: true, roughness: 0.9 }));
  top.position.set(x, ISL_TOP - 0.17, z);
  top.rotation.y = Math.PI / 6;
  top.receiveShadow = true;
  top.userData = { pick: 'island', id: I.id };
  g.add(top);
  // 路環
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(RING_R - 0.42, RING_R + 0.42, 6, 1),
    new THREE.MeshStandardMaterial({ color: 0xd8c9b6, roughness: 0.95 }));
  ring.rotation.x = -Math.PI / 2;
  ring.rotation.z = Math.PI / 6;
  ring.position.set(x, ISL_TOP + 0.012, z);
  ring.receiveShadow = true;
  g.add(ring);
  // 中心廣場
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(1.5, 24), new THREE.MeshStandardMaterial({ color: 0xe6dac9, roughness: 0.95 }));
  plaza.rotation.x = -Math.PI / 2; plaza.position.set(x, ISL_TOP + 0.014, z); plaza.receiveShadow = true;
  g.add(plaza);

  // 節點：中心 + 6 環節點
  const base = isHub ? 0 : (I.ang * Math.PI / 180);
  const center = addNode(x, ISL_TOP, z);
  const ringNodes = [];
  for (let i = 0; i < 6; i++) {
    const a = base + i / 6 * TAU;
    ringNodes.push(addNode(x + Math.sin(a) * RING_R, ISL_TOP, z + Math.cos(a) * RING_R));
  }
  for (let i = 0; i < 6; i++) {
    addEdge(center, ringNodes[i]);
    addEdge(ringNodes[i], ringNodes[(i + 1) % 6]);
  }
  ISL_NODES[I.id] = { center, ring: ringNodes, x, z, base };

  // 外圈路燈 + 串燈 + 盆栽 + 灌木 + 花
  const b = makeBuilder(new THREE.Vector3(x, ISL_TOP, z), 1, 0);
  for (let i = 0; i < 6; i++) {
    const a = base + i / 6 * TAU;
    const lx = Math.sin(a) * (rad - 0.75), lz = Math.cos(a) * (rad - 0.75);
    b.push('cylinder', lx, 0.42, lz, 0.09, 0.84, 0.09, PAL.ink, 0, 0, 0, null, I.id, false);
    b.push('glowsphere', lx, 0.88, lz, 0.20, 0.20, 0.20, PAL.night, 0, 0, 0, null, I.id, false);
    // 盆栽 + 灌木 + 花
    const pa = a + 0.42;
    const px = Math.sin(pa) * (rad - 0.55), pz = Math.cos(pa) * (rad - 0.55);
    b.push('cylinder', px, 0.11, pz, 0.20, 0.22, 0.20, PAL.coral, 0, 0, 0, null, I.id, true);
    b.push('sphere', px, 0.30, pz, 0.30, 0.30, 0.30, PAL.plant[1], 0, 0, 0, null, I.id, true);
    const fa = a - 0.42;
    const fx = Math.sin(fa) * (rad - 0.5), fz = Math.cos(fa) * (rad - 0.5);
    b.push('sphere', fx, 0.09, fz, 0.22, 0.18, 0.22, PAL.plant[2], 0, 0, 0, null, I.id, true);
    for (let k = 0; k < 3; k++) {
      const fa2 = a - 0.2 + k * 0.2;
      b.push('sphere', Math.sin(fa2) * (rad - 0.34), 0.07, Math.cos(fa2) * (rad - 0.34), 0.10, 0.10, 0.10,
        [PAL.pastel[0], PAL.yellow, PAL.pastel[1]][k], 0, 0, 0, null, I.id, true);
    }
    // 島緣串燈
    for (let k = 0; k < 5; k++) {
      const ka = a + (k - 2) * 0.055;
      b.push('glowsphere', Math.sin(ka) * (rad - 0.10), 0.20, Math.cos(ka) * (rad - 0.10), 0.09, 0.09, 0.09, PAL.night, 0, 0, 0, null, I.id, true);
    }
  }
  // 大樹 4–6 棵
  const sp = ISL_SPECIES[I.id];
  const tn = 4 + Math.floor(RNG() * 3);
  for (let i = 0; i < tn; i++) {
    const a = base + (i / tn) * TAU + 0.3;
    const rr = rad - 2.0 - RNG() * 1.4;
    treeSpecies(b, sp, Math.sin(a) * rr, 0, Math.cos(a) * rr, 1.15 + RNG() * 0.35, null, I.id);
  }
  // 長椅
  for (let i = 0; i < 3; i++) {
    const a = base + (i / 3) * TAU + 0.9;
    const rr = RING_R - 1.5;
    const bx = Math.sin(a) * rr, bz = Math.cos(a) * rr;
    b.push('rbox', bx, 0.10, bz, 0.62, 0.07, 0.20, PAL.wood, 0, -a, 0, null, I.id, true);
    b.push('rbox', bx - Math.sin(a) * 0.08, 0.22, bz - Math.cos(a) * 0.08, 0.62, 0.20, 0.05, PAL.wood, 0, -a, 0, null, I.id, true);
  }

  scene.add(g);
  ISL_MESH[I.id] = { group: g, label: null, x, z };
  return g;
}
ISLANDS.forEach(buildIsland);

/* ---------- 香港小店裝飾（每島 2–3 座，唔入細項卡） ---------- */
{
  const DECOR_KINDS = ['chaChaan', 'pawnshop', 'mahjong', 'cinema', 'jockey', 'market', 'kcr', 'lighthouse'];
  for (const I of ISLANDS) {
    const isl = ISL_NODES[I.id];
    const n = 2 + Math.floor(RNG() * 2);
    const used = new Set();
    for (let i = 0; i < n; i++) {
      const kind = DECOR_KINDS[Math.floor(RNG() * DECOR_KINDS.length)];
      if (used.has(kind)) continue;
      used.add(kind);
      const a = isl.base + RNG() * TAU;
      const rr = 4.35 + RNG() * 0.75;                       // 喺 items 環(3.35)同路環(5.8)之間
      const dx = isl.x + Math.sin(a) * rr, dz = isl.z + Math.cos(a) * rr;
      const sc = 0.72 + RNG() * 0.35;
      const b = makeBuilder(new THREE.Vector3(dx, ISL_TOP, dz), sc, RNG() * TAU);
      b.push('cylinder', 0, 0.02, 0, 1.15, 0.05, 1.15, PAL.ink, 0, 0, 0, null, I.id, true); // 陰影裙邊
      ARCH[kind](b, null, I.id);
    }
  }
}

/* ---------- bridges (graph edges between islands) ---------- */
{
  const b = makeBuilder(new THREE.Vector3(0, 0, 0), 1, 0);
  const pairs = [];
  for (let k = 0; k < 6; k++) pairs.push(['hub', ISL_ORDER[k]]);
  for (let k = 0; k < 6; k++) pairs.push([ISL_ORDER[k], ISL_ORDER[(k + 1) % 6]]);
  for (const [a, c] of pairs) {
    const A = ISL_NODES[a], C = ISL_NODES[c];
    let best = null;
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
      const d = GRAPH.nodes[A.ring[i]].distanceTo(GRAPH.nodes[C.ring[j]]);
      if (!best || d < best.d) best = { d, i, j };
    }
    if (!best) continue;
    const na = A.ring[best.i], nc = C.ring[best.j];
    const p1 = GRAPH.nodes[na], p2 = GRAPH.nodes[nc];
    addEdge(na, nc);
    const mid = p1.clone().add(p2).multiplyScalar(0.5);
    const len = p1.distanceTo(p2);
    const ang = Math.atan2(p2.x - p1.x, p2.z - p1.z);
    // deck
    b.push('rbox', mid.x, ISL_TOP - 0.06, mid.z, 1.5, 0.12, len, PAL.wood, 0, ang, 0, null, null);
    // rails
    for (const s of [-1, 1]) {
      const off = new THREE.Vector3(Math.cos(ang), 0, -Math.sin(ang)).multiplyScalar(0.66 * s);
      b.push('rbox', mid.x + off.x, ISL_TOP + 0.10, mid.z + off.z, 0.07, 0.07, len, PAL.eave, 0, ang, 0, null, null);
      for (let k = 0; k <= 4; k++) {
        const t = k / 4;
        const px = lerp(p1.x, p2.x, t) + off.x, pz = lerp(p1.z, p2.z, t) + off.z;
        b.push('glowsphere', px, ISL_TOP + 0.16, pz, 0.10, 0.10, 0.10, PAL.night, 0, 0, 0, null, null);
      }
    }
  }
}

/* ---------- 細項模型放置 ---------- */
const ITEM_WORLD = {};        // itemId -> {pos: Vector3, isl, scale, rot}
{
  const islandItems = {};
  for (const id in ITEMS) { (islandItems[ITEMS[id].isl] ||= []).push(id); }
  for (const islId in islandItems) {
    const ids = islandItems[islId];
    const isl = ISL_NODES[islId];
    const hub = islId === 'hub';
    ids.forEach((id, k) => {
      const it = ITEMS[id];
      const a = isl.base + (k / ids.length) * TAU + 0.35;
      const rr = hub ? 3.5 : 3.35;
      const px = isl.x + Math.sin(a) * rr, pz = isl.z + Math.cos(a) * rr;
      const giant = ['book', 'coin', 'clock', 'globe', 'skyscraper', 'estate'].includes(it.model);
      const scale = giant ? (['skyscraper', 'estate'].includes(it.model) ? 3.6 : 3.1) : 2.5;
      const rot = -a + (giant ? 0 : 0.4);
      const b = makeBuilder(new THREE.Vector3(px, ISL_TOP, pz), scale, rot);
      // 暗色陰影裙邊：1.05× 底座半徑、0.06 厚，避免模型浮喺島面
      b.push('cylinder', 0, 0.02, 0, 1.22, 0.06, 1.22, PAL.ink, 0, 0, 0, id, islId);
      ARCH[it.model](b, id, islId);
      // 巨型符號物件：金屬描邊（3 個互相垂直嘅 torus）
      if (giant) {
        const mc = PAL.metal !== undefined ? PAL.metal : 0xc9b083;
        b.push('torus', 0, 0.80, 0, 1.14, 1.14, 1.14, mc, Math.PI / 2, 0, 0, id, islId);
        b.push('torus', 0, 0.80, 0, 1.14, 1.14, 1.14, mc, 0, Math.PI / 2, 0, id, islId);
      }
      ITEM_WORLD[id] = { pos: new THREE.Vector3(px, ISL_TOP, pz), isl: islId, scale, rot };
    });
  }
}

/* ---------- build instanced meshes ---------- */
for (const kind in KITS) {
  const list = kitList[kind];
  if (!list.length) continue;
  const mesh = new THREE.InstancedMesh(KITS[kind].geo, KITS[kind].glow ? MAT.glow : MAT.solid, list.length);
  mesh.castShadow = !KITS[kind].glow;
  mesh.receiveShadow = !KITS[kind].glow;
  mesh.userData = { kind };
  const c = new THREE.Color();
  list.forEach((rec, i) => {
    mesh.setMatrixAt(i, rec.m);
    mesh.setColorAt(i, rec.color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  kitMeshes[kind] = mesh;
  scene.add(mesh);
}

/* ---------- 動態新增（Phase 2/3：server mutation → 即時加建） ---------- */
// standalone builder：唔用 instanced kit，直接建 Mesh group（新 item 數量少，可接受）
function standaloneBuilder(origin, scale, rotY) {
  const group = new THREE.Group();
  const base = new THREE.Matrix4().compose(
    origin,
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)),
    new THREE.Vector3(scale, scale, scale));
  return {
    push(kind, x, y, z, sx, sy, sz, color, rx = 0, ry = 0, rz = 0, item = null, island = null, small = false) {
      const j = 1 + (Math.random() * 2 - 1) * 0.0072;
      const local = new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
        new THREE.Vector3(sx * j, sy * j, sz * j));
      const world = base.clone().multiply(local);
      const mat = KITS[kind].glow
        ? new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0, emissive: new THREE.Color(color), emissiveIntensity: 0.9 })
        : new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.78, metalness: 0 });
      const mesh = new THREE.Mesh(KITS[kind].geo, mat);
      mesh.matrix.copy(world);
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = !KITS[kind].glow;
      if (item) mesh.userData = { pick: 'item', id: item };
      if (island) mesh.userData = { pick: 'island', id: island };
      group.add(mesh);
    }
  };
}
window.__addItemMesh = function (item) {
  const isl = ISL_NODES[item.islandId];
  if (!isl || !ARCH[item.model]) return false;
  const ids = Object.keys(ITEMS).filter(k => ITEMS[k].isl === item.islandId);
  const a = isl.base + (0.35 + (ids.length % 6) * 0.9 + RNG() * 0.25);
  const rr = 3.35;
  const px = isl.x + Math.sin(a) * rr, pz = isl.z + Math.cos(a) * rr;
  const b = standaloneBuilder(new THREE.Vector3(px, ISL_TOP, pz), 2.5, -a + 0.4);
  b.push('cylinder', 0, 0.02, 0, 1.22, 0.06, 1.22, PAL.ink, 0, 0, 0, item.id, item.islandId);
  ARCH[item.model](b, item.id, item.islandId);
  ITEM_WORLD[item.id] = { pos: new THREE.Vector3(px, ISL_TOP, pz), isl: item.islandId, scale: 2.5, rot: -a + 0.4 };
  scene.add(b.group);
  if (typeof STATE !== 'undefined') STATE.dirty = true;   // 唔 set dirty 唔會 render
  return true;
};
window.__addIsland = function (isl) {
  // 已完整建好（ISL_NODES 有 entry）→ skip
  if (ISL_NODES[isl.id]) return false;
  // ISLANDS 入面有同 id 但未建好嘅污染 entry（舊 code push 咗但 buildIsland 冇行）→ 移除
  const pollIdx = ISLANDS.findIndex(i => i.id === isl.id);
  if (pollIdx >= 0) ISLANDS.splice(pollIdx, 1);
  // 新聞島：外圈 r=32，角度避開現有島（唔好同 hub/theme 島重疊）
  const taken = new Set(ISLANDS.filter(I => I.ang !== null).map(I => I.ang));
  let ang = (RNG() * 360);
  for (let i = 0; i < 24 && taken.has(ang); i++) ang = (ang + 15) % 360;
  const r = isl.radius || 32;
  ISL_POS[isl.id] = new THREE.Vector2(Math.cos(ang * Math.PI / 180) * r, Math.sin(ang * Math.PI / 180) * r);
  isl.ang = ang;
  ISL_BY_ID[isl.id] = isl;
  ISLANDS.push(isl);
  const g = buildIsland(isl);
  // 新聞島 label（否則 updateLabels crash：ISL_MESH[id].label 係 null）
  if (typeof createIslandLabel === 'function') createIslandLabel(isl);
  // 💡 唔 set dirty → CSS2DRenderer 唔會 re-render → 新 label/mesh 睇唔到
  if (typeof STATE !== 'undefined') STATE.dirty = true;
  if (typeof updateLabels === 'function') updateLabels();
  return true;
};
window.__islandIds = () => Object.keys(ISL_NODES);

/* ---------- 路燈光池（加法混合） ---------- */
const lampPools = [];
{
  const poolMat = new THREE.MeshBasicMaterial({ color: 0xffc777, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const poolGeo = new THREE.CircleGeometry(1.15, 20);
  const mesh = new THREE.InstancedMesh(poolGeo, poolMat, 60);
  const m = new THREE.Matrix4();
  let i = 0;
  for (const I of ISLANDS) {
    const isl = ISL_NODES[I.id];
    const base = isl.base, rad = I.id === 'hub' ? ISL_RAD + 0.5 : ISL_RAD;
    for (let k = 0; k < 6 && i < 60; k++) {
      const a = base + k / 6 * TAU;
      m.makeRotationX(-Math.PI / 2);
      m.setPosition(isl.x + Math.sin(a) * (rad - 0.75), ISL_TOP + 0.02, isl.z + Math.cos(a) * (rad - 0.75));
      mesh.setMatrixAt(i++, m);
      lampPools.push({ isl: I.id });
    }
  }
  mesh.count = i;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.renderOrder = 2;
  scene.add(mesh);
  window.__setLampPool = (night) => { poolMat.opacity = night * 0.62; };
}
