/* ============ 03 · terrain basin + background trees + mountains + clouds + sea props ============ */

/* ---------- 盆地地形 ---------- */
const TERRAIN_SIZE = 200, TERRAIN_SEG = 176;

/* 城市盆地（r<32）保持沉入潟湖；環狀山由 r=40 才開始，避免侵入城市。
   所有 fbm 噪聲都乘上 ≥32 先起動嘅窗，確保 r<32 冇山。 */
function terrainHeight(x, z) {
  const r = Math.hypot(x, z);
  let h = smoothstep(40, 55, r) * (1 - smoothstep(72, 94, r)) * 13.0;
  h += (fbm(x * 0.035 + 11, z * 0.035 + 7) - 0.5) * 7.0 * smoothstep(40, 56, r);
  h += (fbm(x * 0.11 + 3, z * 0.11 + 19) - 0.5) * 2.0 * smoothstep(32, 46, r);
  // 梯田量化
  if (h > 0.6) h = Math.round(h / 1.15) * 1.15 + (fbm(x * 0.5, z * 0.5) - 0.5) * 0.34;
  // 城市盆地：r<32 壓到海平面下（島嶼浮在潟湖上）
  h -= (1 - smoothstep(28, 38, r)) * 5.0;
  // 鏡頭那一側（+z）壓低並沉入潟湖之下，避免前景綠色台地擋住城市
  const camSide = clamp((z + 12) / 46, 0, 1);
  h *= lerp(1, 0.10, camSide * smoothstep(16, 36, r));
  h -= camSide * smoothstep(20, 46, r) * 5.0;
  // 外圈沉入海面（否則地形平面邊緣會變成一大片綠色台地）
  h -= smoothstep(88, 104, r) * 10.0;
  return h;
}

const terrainGeo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEG, TERRAIN_SEG);
terrainGeo.rotateX(-Math.PI / 2);
{
  const pos = terrainGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cRiver = new THREE.Color(0x8fb3ad), cSand = new THREE.Color(0xd9c9a3),
    cField = new THREE.Color(0xaec493), cGrass = new THREE.Color(0xa3b986),
    cForest = new THREE.Color(0x6f8a62), cRock = new THREE.Color(0xb2a38d);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    // 依高度上頂點色
    const hy = h;
    if (hy < -1.0) tmp.copy(cRiver);
    else if (hy < 0.7) tmp.copy(cRiver).lerp(cSand, smoothstep(-1.0, 0.7, hy));
    else if (hy < 2.6) tmp.copy(cSand).lerp(cField, smoothstep(0.7, 2.6, hy));
    else if (hy < 5.2) tmp.copy(cField).lerp(cGrass, smoothstep(2.6, 5.2, hy));
    else if (hy < 9.0) tmp.copy(cGrass).lerp(cForest, smoothstep(5.2, 9.0, hy));
    else tmp.copy(cForest).lerp(cRock, smoothstep(9.0, 13.0, hy));
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();
}
const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshStandardMaterial({
  vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0
}));
terrain.receiveShadow = true;
scene.add(terrain);

/* ---------- 背景樹 ---------- */
function coniferGeo() {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.ConeGeometry(0.62 - i * 0.14, 1.05 - i * 0.16, 7);
    g.translate(0, 0.52 + i * 0.48, 0);
    parts.push(g);
  }
  const trunk = new THREE.CylinderGeometry(0.1, 0.13, 0.55, 6);
  trunk.translate(0, 0.26, 0);
  parts.push(trunk);
  return mergeGeometries(parts.map(ni), false);
}
function broadleafGeo() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.1, 0.14, 0.7, 6);
  trunk.translate(0, 0.35, 0);
  parts.push(trunk);
  const blobs = [[0, 1.05, 0, 0.60], [0.34, 0.86, 0.18, 0.44], [-0.30, 0.92, -0.14, 0.40], [0.06, 1.32, -0.22, 0.38]];
  for (const [x, y, z, s] of blobs) {
    const g = new THREE.IcosahedronGeometry(s, 0);
    g.translate(x, y, z);
    parts.push(g);
  }
  return mergeGeometries(parts.map(ni), false);
}
/* mergeGeometries 需要一致的 index/attribute：IcosahedronGeometry 無 index，
   其餘都有 → 全部轉成 non-indexed 再合併，否則 merge 回傳 null */
function ni(g) { return g.index ? g.toNonIndexed() : g; }

const TREE_N = QUALITY === 'low' ? 900 : 3400;
const treeMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.92, metalness: 0, color: 0xffffff });
const treeConifer = new THREE.InstancedMesh(coniferGeo(), treeMat, Math.floor(TREE_N * 0.55));
const treeBroad = new THREE.InstancedMesh(broadleafGeo(), treeMat, TREE_N - Math.floor(TREE_N * 0.55));
treeConifer.castShadow = false; treeConifer.receiveShadow = false;
treeBroad.castShadow = false; treeBroad.receiveShadow = false;
{
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  let ci = 0, bi = 0, maxC = treeConifer.count, maxB = treeBroad.count;
  let guard = 0;
  while ((ci < maxC || bi < maxB) && guard < TREE_N * 12) {
    guard++;
    const a = RNG() * TAU, rr = 38 + RNG() * 42;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    const h = terrainHeight(x, z);
    if (h < 0.25) continue;                      // 水下不種樹
    const camSide = clamp((z + 12) / 46, 0, 1);
    if (RNG() < camSide * 0.55) continue;         // 鏡頭側稀疏
    const sc = 0.75 + RNG() * 0.85;
    p.set(x, h - 0.1, z);
    q.setFromEuler(new THREE.Euler(0, RNG() * TAU, 0));
    s.set(sc * (0.85 + RNG() * 0.3), sc, sc * (0.85 + RNG() * 0.3));
    m.compose(p, q, s);
    const green = new THREE.Color().setHSL(0.24 + RNG() * 0.07, 0.30 + RNG() * 0.16, 0.24 + RNG() * 0.16);
    if (ci < maxC) { treeConifer.setMatrixAt(ci, m); treeConifer.setColorAt(ci, green); ci++; }
    else if (bi < maxB) { treeBroad.setMatrixAt(bi, m); treeBroad.setColorAt(bi, green); bi++; }
  }
  for (let i = ci; i < maxC; i++) { m.makeScale(0, 0, 0); treeConifer.setMatrixAt(i, m); }
  for (let i = bi; i < maxB; i++) { m.makeScale(0, 0, 0); treeBroad.setMatrixAt(i, m); }
  treeConifer.instanceMatrix.needsUpdate = true; treeBroad.instanceMatrix.needsUpdate = true;
  if (treeConifer.instanceColor) treeConifer.instanceColor.needsUpdate = true;
  if (treeBroad.instanceColor) treeBroad.instanceColor.needsUpdate = true;
}
scene.add(treeConifer); scene.add(treeBroad);

/* ---------- 三圈遠山剪影帶 ---------- */
const silhouetteBands = [];
{
  const bands = [
    { r: 118, h: 8, c: 0x7d9b8d, o: 1.0 },
    { r: 158, h: 11, c: 0x8fa9a3, o: 1.0 },
    { r: 208, h: 14, c: 0xa3b6b6, o: 1.0 }
  ];
  for (const b of bands) {
    const g = new THREE.CylinderGeometry(b.r, b.r * 0.94, b.h, 72, 1, true);
    const col = new THREE.Color(b.c);
    const geo = g;
    // 起伏的山脊：頂點擾動
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (y > 0) {
        const ang = Math.atan2(z, x);
        p.setY(i, y + (fbm(ang * 6 + b.r, b.r * 0.3) - 0.5) * b.h * 0.55);
      }
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, side: THREE.BackSide, fog: false, transparent: true, opacity: 0.95 }));
    mesh.position.y = b.h * 0.10 - 4;
    mesh.renderOrder = -5;
    scene.add(mesh);
    silhouetteBands.push(mesh);
  }
}

/* ---------- 12 團雲 ---------- */
const clouds = [];
{
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1, metalness: 0, transparent: true, opacity: 0.9 });
  for (let i = 0; i < 12; i++) {
    const g = new THREE.Group();
    const n = 4 + Math.floor(RNG() * 3);
    for (let j = 0; j < n; j++) {
      const r = 2.0 + RNG() * 2.4;
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), cloudMat);
      m.position.set((RNG() - 0.5) * 7, (RNG() - 0.5) * 1.6, (RNG() - 0.5) * 4.5);
      m.scale.y = 0.55;
      g.add(m);
    }
    g.position.set(-110 + RNG() * 220, 26 + RNG() * 22, -90 + RNG() * 180);
    g.userData.speed = 0.5 + RNG() * 0.55;
    g.userData.x0 = g.position.x;
    scene.add(g);
    clouds.push(g);
  }
}

/* ---------- 海上點綴：小島、燈塔、帆船 ---------- */
const seaProps = [];
{
  const sandMat = new THREE.MeshStandardMaterial({ color: 0xd9c9a3, flatShading: true, roughness: 0.95 });
  const rockMat = new THREE.MeshStandardMaterial({ color: 0xb2a38d, flatShading: true, roughness: 1 });
  const spots = [[-52, -44], [64, -30], [-38, 56], [72, 48], [8, -74]];
  for (const [x, z] of spots) {
    const g = new THREE.Group();
    const r = 2.4 + RNG() * 3.4;
    const base = new THREE.Mesh(new THREE.ConeGeometry(r, r * 0.55, 9), rockMat);
    base.position.y = r * 0.275 - 1.0;
    g.add(base);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.78, 0.4, 9), sandMat);
    top.position.y = r * 0.55 - 1.0;
    g.add(top);
    const palm = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 2.0, 6), new THREE.MeshStandardMaterial({ color: 0xb48560, flatShading: true }));
    trunk.position.y = 1.0; palm.add(trunk);
    for (let k = 0; k < 5; k++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.7, 5), new THREE.MeshStandardMaterial({ color: 0x8db86f, flatShading: true }));
      leaf.position.set(0, 2.0, 0);
      leaf.rotation.z = Math.PI / 2.6;
      leaf.rotation.y = (k / 5) * TAU;
      const piv = new THREE.Group(); piv.rotation.y = (k / 5) * TAU;
      leaf.rotation.set(0, 0, Math.PI / 2.6);
      leaf.position.set(Math.cos((k / 5) * TAU) * 0.8, 2.0, Math.sin((k / 5) * TAU) * 0.8);
      piv.add(leaf); palm.add(piv);
    }
    palm.position.y = r * 0.55 - 0.8;
    g.add(palm);
    g.position.set(x, 0, z);
    g.userData.bob = RNG() * TAU;
    scene.add(g);
    seaProps.push({ obj: g, kind: 'islet' });
  }
  // 燈塔
  const lh = new THREE.Group();
  const lhMat = new THREE.MeshStandardMaterial({ color: 0xfff8f4, flatShading: true, roughness: 0.8 });
  const lhRed = new THREE.MeshStandardMaterial({ color: 0xdb6a41, flatShading: true, roughness: 0.8 });
  const lhBase = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.3, 0.9, 10), rockMat); lhBase.position.y = -0.7; lh.add(lhBase);
  for (let i = 0; i < 4; i++) {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.62 - i * 0.05, 0.68 - i * 0.05, 1.5, 10), i % 2 ? lhRed : lhMat);
    seg.position.y = 0.55 + i * 1.45; lh.add(seg);
  }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), new THREE.MeshStandardMaterial({ color: 0xffc777, emissive: 0xffc777, emissiveIntensity: 0.2 }));
  lamp.position.y = 6.4; lh.add(lamp);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.8, 0.9, 10), lhRed); cap.position.y = 7.1; lh.add(cap);
  lh.position.set(-16, 0, -34);
  scene.add(lh);
  const lhLight = new THREE.PointLight(0xffc777, 0, 26, 2);
  lhLight.position.set(-16, 6.4, -34);
  scene.add(lhLight);
  seaProps.push({ obj: lh, kind: 'lighthouse', lamp, light: lhLight });

  // 帆船
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.55, 0.9), new THREE.MeshStandardMaterial({ color: [0xdb6a41, 0xfcea8b, 0x3e7c8c][i], flatShading: true, roughness: 0.7 }));
    hull.position.y = 0.1; b.add(hull);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.6, 6), new THREE.MeshStandardMaterial({ color: 0xb48560, flatShading: true }));
    mast.position.y = 1.6; b.add(mast);
    const sail = new THREE.Mesh(new THREE.ConeGeometry(0.85, 2.0, 3), new THREE.MeshStandardMaterial({ color: 0xfff8f4, flatShading: true, roughness: 0.8 }));
    sail.position.set(0.35, 1.75, 0); sail.rotation.z = -Math.PI / 2; sail.scale.z = 0.22;
    b.add(sail);
    b.position.set(-30 + i * 26, -0.85, 22 + i * 9);
    b.userData.phase = RNG() * TAU; b.userData.radius = 16 + i * 5; b.userData.speed = 0.10 + i * 0.03;
    scene.add(b);
    seaProps.push({ obj: b, kind: 'boat' });
  }
}
