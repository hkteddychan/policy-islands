/* ============ 08 · boot, resize, loop, debug hook ============ */
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  STATE.dirty = true;
}
window.addEventListener('resize', resize);
if (window.ResizeObserver) new ResizeObserver(resize).observe(document.getElementById('app'));

/* reduced motion live toggle */
STATE.reducedQuery.addEventListener('change', (e) => {
  STATE.reduced = e.matches;
  if (STATE.reduced) { flight.active = false; }
  STATE.dirty = true;
});

/* ---------- glow intensity hook ---------- */
window.__setGlow = (gi) => { MAT.glow.emissiveIntensity = gi; };
window.__setIslandLights = (night) => {
  for (const p of seaProps) if (p.kind === 'lighthouse') { p.lamp.material.emissiveIntensity = 0.1 + night * 3.2; p.light.intensity = night * 12; }
};

/* ---------- init ---------- */
if (QS.get('still') === '1') { Clock.paused = true; TOGGLES.pause = true; document.getElementById('tglPause').classList.add('on'); }
applyI18n();
renderSidebar();
renderLog();
setupSheets();
resize();
updateDayCycle(0);
refreshHighlight();
refreshFlowVisibility();
updateLabels();
showIntro(false);

document.getElementById('load').style.display = 'none';

/* ---------- main loop ---------- */
const clock3 = new THREE.Clock();
let animT = 0;
let labelTick = 0;
let fpsAcc = 0, fpsFrames = 0, degraded = false;
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock3.getDelta(), 0.08);
  if (!STATE.reduced) animT += dt;
  STATE.elapsed += dt;

  // 效能守護：連續低幀率 → 降級（關陰影 + 減像素比）
  if (!degraded && QUALITY === 'auto') {
    fpsAcc += dt; fpsFrames++;
    if (fpsFrames >= 90) {
      const fps = fpsFrames / fpsAcc;
      if (fps < 24) {
        degraded = true;
        renderer.shadowMap.enabled = false;
        renderer.setPixelRatio(Math.min(renderer.getPixelRatio(), 0.75));
        sun.castShadow = false;
        scene.traverse(o => { if (o.isMesh) o.material.needsUpdate = true; });
      }
      fpsAcc = 0; fpsFrames = 0;
    }
  }

  if (!TOGGLES.pause) {
    updateDayCycle(dt);
    seaUniforms.uTime.value = animT;
    flowMat.uniforms.uTime.value = animT;
    for (const f of FLOWS) FLOW_OBJ[f.id].tube.material.uniforms.uTime.value = animT;
    updateWalkers(dt, animT);
    // clouds
    for (const c of clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 130) c.position.x = -130;
    }
    // sea props bobbing
    for (const p of seaProps) {
      if (p.kind === 'boat') {
        const u = p.obj.userData;
        const a = animT * u.speed + u.phase;
        p.obj.position.x = Math.cos(a) * u.radius;
        p.obj.position.z = Math.sin(a) * u.radius * 0.6 + 22;
        p.obj.position.y = -0.85 + Math.sin(animT * 1.3 + u.phase) * 0.09;
        p.obj.rotation.y = -a;
        p.obj.rotation.z = Math.sin(animT * 0.9 + u.phase) * 0.05;
      } else if (p.kind === 'islet') {
        p.obj.position.y = Math.sin(animT * 0.7 + p.obj.userData.bob) * 0.05;
      }
    }
    // labels + pins need render
    STATE.dirty = true;
  }
  updateFlight(dt);
  controls.update();

  labelTick += dt;
  if (labelTick > 0.12) { labelTick = 0; updateLabels(); }

  if (STATE.dirty) {
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    STATE.dirty = false;
  }
}
tick();

/* ---------- debug hook ---------- */
window.__pid = () => ({
  ready: true,
  clock: Clock.label,
  night: +STATE.night.toFixed(3),
  islands: ISLANDS.length,
  items: Object.keys(ITEMS).length,
  flows: FLOWS.length,
  walkers: WALKERS.length,
  kitKinds: Object.keys(kitMeshes).length,
  instances: Object.values(kitMeshes).reduce((a, m) => a + m.count, 0),
  drawCalls: renderer.info.render.calls,
  triangles: renderer.info.render.triangles,
  sel: SEL,
  toggles: Object.assign({}, TOGGLES),
  visibleFlows: FLOWS.filter(f => FLOW_OBJ[f.id].tube.visible).map(f => f.id),
  walker0: WALKERS[0] ? { x: +WALKERS[0].x.toFixed(2), z: +WALKERS[0].z.toFixed(2), t: +WALKERS[0].t.toFixed(3) } : null,
  dom: { themes: document.querySelectorAll('#tabThemes details.isl').length, flowRows: document.querySelectorAll('#tabFlows .flrow').length },
  pins: (typeof pinGroup !== 'undefined') ? pinGroup.children.length : -1,
  pinEls: document.querySelectorAll('.pinlab').length,
  css2dEls: document.getElementById('css2d').children.length,
  islandLabels: document.querySelectorAll('.ilabel').length,
  walkerNames: document.querySelectorAll('.wname').length,
  errors: window.__errs || [],
  degraded: degraded,
  quality: QUALITY,
  fps: +(1 / Math.max(0.001, clock3.getDelta())).toFixed(1)
});
/* ---------- true pixel probe (headless screenshots don't composite WebGL) ---------- */
window.__sample = (grid) => {
  const gl = renderer.getContext();
  renderer.render(scene, camera);
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(4);
  const out = [];
  const n = grid || 5;
  for (let gy = 0; gy < n; gy++) {
    const row = [];
    for (let gx = 0; gx < n; gx++) {
      const x = Math.floor((gx + 0.5) / n * w);
      const y = Math.floor((gy + 0.5) / n * h);   // gl origin bottom-left
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      row.push([px[0], px[1], px[2]]);
    }
    out.push(row);
  }
  return JSON.stringify({ size: [w, h], grid: out });
};
window.__dumpPNG = () => {
  const gl = renderer.getContext();
  renderer.render(scene, camera);
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const buf = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d');
  const img = cx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4, dst = y * w * 4;
    img.data.set(buf.subarray(src, src + w * 4), dst);
  }
  cx.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
};
window.__probeWorld = (pts) => {
  const gl = renderer.getContext();
  renderer.render(scene, camera);
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const v = new THREE.Vector3();
  const px = new Uint8Array(4);
  const out = [];
  for (const P of pts) {
    v.set(P[0], P[1], P[2]).project(camera);
    const x = Math.round((v.x * 0.5 + 0.5) * w);
    const y = Math.round((v.y * 0.5 + 0.5) * h);
    if (x < 0 || y < 0 || x >= w || y >= h) { out.push({ P, off: true }); continue; }
    gl.readPixels(x, h - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    out.push({ P, xy: [x, y], rgb: [px[0], px[1], px[2]] });
  }
  return JSON.stringify(out);
};
window.__internals = { terrainHeight, ISL_POS, ISL_NODES, ITEM_WORLD, ISLANDS, FLOWS, FLOW_OBJ, scene, camera, renderer, controls, Clock, STATE, TOGGLES, ARCH };
window.__pick = (px, py) => {
  const rc = new THREE.Raycaster();
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  rc.setFromCamera(new THREE.Vector2((px / w) * 2 - 1, -(py / h) * 2 + 1), camera);
  const hits = rc.intersectObjects(scene.children, true).slice(0, 6);
  return JSON.stringify(hits.map(h => ({
    d: +h.distance.toFixed(1),
    type: h.object.type,
    mat: h.object.material && h.object.material.type,
    col: h.object.material && h.object.material.color ? '#' + h.object.material.color.getHexString() : '',
    geo: h.object.geometry ? h.object.geometry.type : '',
    userData: h.object.userData,
    inst: h.instanceId
  })));
};
window.__errs = [];
window.addEventListener('error', (e) => { window.__errs.push(String(e.message)); });
