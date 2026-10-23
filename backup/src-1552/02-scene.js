/* ============ 02 · scene core: renderer / camera / lights / day-night ============ */
const QS = new URLSearchParams(location.search);
const QUALITY = QS.get('q') || 'auto';         // auto | low | high
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: QUALITY !== 'low', powerPreference: 'high-performance' });
renderer.setPixelRatio(QUALITY === 'low' ? 0.6 : Math.min(window.devicePixelRatio || 1, 1.4));
renderer.shadowMap.enabled = QUALITY !== 'low';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xaee0ee, 70, 210);

const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 400);
camera.position.set(34, 18, 54);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.minDistance = 12;
controls.maxDistance = 110;
controls.maxPolarAngle = Math.PI * 0.487;
controls.target.set(0, 7, 0);
controls.enablePan = true;

/* ---------- CSS2D ---------- */
/* CSS2DRenderer 在 constructor 就鎖定 domElement（parameters.element），
   事後賦值 labelRenderer.domElement 唔會生效 → 必須傳入 element 參數 */
const labelHost = document.getElementById('css2d');
const labelRenderer = new CSS2DRenderer({ element: labelHost });
labelHost.style.position = 'absolute';
labelHost.style.top = '0';
labelHost.style.left = '0';
labelHost.style.pointerEvents = 'none';
labelHost.style.overflow = 'hidden';
document.getElementById('app').appendChild(labelHost);

/* ---------- lights ---------- */
const hemi = new THREE.HemisphereLight(0xbfe4f2, 0x6b6154, 0.75);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d8, 1.5);
sun.castShadow = QUALITY !== 'low';
sun.shadow.mapSize.set(QUALITY === 'low' ? 1024 : 2048, QUALITY === 'low' ? 1024 : 2048);
sun.shadow.camera.left = -60; sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 220;
sun.shadow.bias = -0.0006;
scene.add(sun); scene.add(sun.target);
const moon = new THREE.DirectionalLight(0x9fb6ff, 0.0);
moon.position.set(-30, 40, -20);
scene.add(moon);

/* ---------- sky dome ---------- */
const skyUniforms = {
  topColor: { value: new THREE.Color(0x2f6fb5) },
  midColor: { value: new THREE.Color(0x9fd4ec) },
  botColor: { value: new THREE.Color(0xf7e2c4) },
  sunDir: { value: new THREE.Vector3(0, 1, 0) },
  sunColor: { value: new THREE.Color(0xfff0d8) },
  night: { value: 0 }
};
const skyMat = new THREE.ShaderMaterial({
  uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false,
  vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
  fragmentShader: `
    uniform vec3 topColor, midColor, botColor, sunColor, sunDir; uniform float night; varying vec3 vP;
    void main(){
      vec3 d = normalize(vP);
      float h = d.y*0.5+0.5;
      vec3 c = mix(botColor, midColor, smoothstep(0.42,0.55,h));
      c = mix(c, topColor, smoothstep(0.52,0.92,h));
      float sd = max(dot(d, normalize(sunDir)), 0.0);
      c += sunColor * pow(sd, 320.0) * 1.6 * (1.0-night);
      c += sunColor * pow(sd, 9.0) * 0.20 * (1.0-night);
      c = mix(c, vec3(0.05,0.07,0.16), night*0.72);
      gl_FragColor = vec4(c,1.0);
    }`
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(320, 32, 20), skyMat);
scene.add(sky);

/* ---------- sea ---------- */
const seaUniforms = {
  uTime: { value: 0 }, uNight: { value: 0 },
  uShallow: { value: new THREE.Color(0x7fd3d8) }, uDeep: { value: new THREE.Color(0x2a6b8f) }
};
const seaMat = new THREE.ShaderMaterial({
  uniforms: seaUniforms, transparent: true,
  vertexShader: `
    uniform float uTime; varying vec3 vP; varying float vW;
    void main(){ vP = position; vec3 p = position;
      float w = sin(p.x*0.16 + uTime*0.9)*0.16 + sin(p.y*0.13 - uTime*0.7)*0.14;
      p.z += w; vW = w;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); }`,
  fragmentShader: `
    uniform vec3 uShallow, uDeep; uniform float uNight, uTime; varying vec3 vP; varying float vW;
    void main(){
      float r = length(vP.xy);
      vec3 c = mix(uShallow, uDeep, smoothstep(10.0, 150.0, r));
      c += vW*0.55;
      float sparkle = smoothstep(0.86, 1.0, sin(vP.x*0.9 + uTime*1.7)*sin(vP.y*0.75 - uTime*1.3));
      c += sparkle*0.10*(1.0-uNight);
      c = mix(c, vec3(0.04,0.07,0.15), uNight*0.62);
      gl_FragColor = vec4(c, 0.93);
    }`
});
const sea = new THREE.Mesh(new THREE.PlaneGeometry(600, 600, 96, 96), seaMat);
sea.rotation.x = -Math.PI / 2;
sea.position.y = -1.15;
scene.add(sea);

/* ---------- clock ---------- */
const Clock = {
  minutes: 600,               // 10:00
  speed: 10,                  // 每秒 10 分鐘 → 一天 144 秒
  paused: false,
  get hour() { return Math.floor(this.minutes / 60) % 24; },
  get min() { return Math.floor(this.minutes % 60); },
  get label() { return String(this.hour).padStart(2, '0') + ':' + String(this.min).padStart(2, '0'); },
  set(h, m) { this.minutes = (h % 24) * 60 + (m || 0); }
};

/* ---------- day / night ---------- */
const DAY_COLS = {
  dawnTop: 0x3d6fa8, dawnMid: 0xf0b183, dawnBot: 0xfbe3c0,
  dayTop: 0x2f6fb5, dayMid: 0x9fd4ec, dayBot: 0xd9eef6,
  duskTop: 0x3a4f8c, duskMid: 0xf0916a, duskBot: 0xffd6a8,
  nightTop: 0x080e22, nightMid: 0x152241, nightBot: 0x27355c
};
const cA = new THREE.Color(), cB = new THREE.Color(), cC = new THREE.Color();
function mixCol(out, a, b, t) { out.setHex(a); cB.setHex(b); out.lerp(cB, t); return out; }

const STATE = {
  night: 0, day: 1, elapsed: 0, dirty: true,
  reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches
};
STATE.reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

function updateDayCycle(dt) {
  if (!Clock.paused && !STATE.reduced) {
    Clock.minutes = (Clock.minutes + dt * Clock.speed) % 1440;
  }
  const min = Math.round(Clock.minutes / 10) * 10;   // 量化到 10 分鐘
  const t = clamp((min - 360) / 720, 0, 1);
  const az = Math.PI * (0.15 + 0.7 * t);
  const el = 0.35 + Math.sin(t * Math.PI) * 0.75;
  const dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), 0.55 * Math.cos(el) + 0.35).normalize();
  sun.position.copy(dir).multiplyScalar(40);
  sun.target.position.set(0, 0, 0);
  skyUniforms.sunDir.value.copy(dir);

  // night factor 0..1 —— 由時鐘決定（太陽方位公式在 18:00 後 t 被 clamp，
  // 只用 el 會令 21:00 變成黃昏，所以夜間光照用鐘點推算）
  const dayWin = smoothstep(300, 420, min) * (1 - smoothstep(1020, 1170, min));
  const night = 1 - dayWin;
  STATE.night = night;
  STATE.day = 1 - night;
  skyUniforms.night.value = night;
  seaUniforms.uNight.value = night;

  // sky colours
  const top = new THREE.Color(), mid = new THREE.Color(), bot = new THREE.Color();
  if (el < 0.42) { // dawn / dusk
    const k = smoothstep(0.12, 0.42, el);
    top.setHex(DAY_COLS.duskTop).lerp(cA.setHex(DAY_COLS.dayTop), k);
    mid.setHex(DAY_COLS.duskMid).lerp(cA.setHex(DAY_COLS.dayMid), k);
    bot.setHex(DAY_COLS.duskBot).lerp(cA.setHex(DAY_COLS.dayBot), k);
  } else {
    top.setHex(DAY_COLS.dayTop); mid.setHex(DAY_COLS.dayMid); bot.setHex(DAY_COLS.dayBot);
  }
  // night blend
  top.lerp(cA.setHex(DAY_COLS.nightTop), night);
  mid.lerp(cA.setHex(DAY_COLS.nightMid), night);
  bot.lerp(cA.setHex(DAY_COLS.nightBot), night);
  skyUniforms.topColor.value.copy(top);
  skyUniforms.midColor.value.copy(mid);
  skyUniforms.botColor.value.copy(bot);
  scene.fog.color.copy(mid).lerp(cA.setHex(0x0d1730), night * 0.8);
  renderer.setClearColor(scene.fog.color);

  // lights: 夜晚 hemi 反而較強（冷藍但看得清楚）
  hemi.color.setHex(0xbfe4f2).lerp(cA.setHex(0x6f86c8), night);
  hemi.groundColor.setHex(0x6b6154).lerp(cA.setHex(0x22283c), night);
  hemi.intensity = lerp(0.75, 1.05, night);
  sun.intensity = lerp(1.55, 0.16, night);
  sun.color.setHex(0xfff0d8).lerp(cA.setHex(0xffb27a), night * 0.7);
  moon.intensity = night * 0.55;
  moon.position.set(-dir.x * 40, 40, -dir.z * 40);
  seaUniforms.uShallow.value.setHex(0x7fd3d8).lerp(cA.setHex(0x2c4a6e), night);
  seaUniforms.uDeep.value.setHex(0x2a6b8f).lerp(cA.setHex(0x0c1c38), night);

  // emissive night glow
  const gi = 0.05 + night * 3.2;
  if (typeof window.__setGlow === 'function') window.__setGlow(gi);
  if (typeof window.__setLampPool === 'function') window.__setLampPool(night);
  if (typeof window.__setIslandLights === 'function') window.__setIslandLights(night);

  const ce = document.getElementById('clockTxt');
  if (ce) ce.textContent = Clock.label;
  STATE.dirty = true;
}
