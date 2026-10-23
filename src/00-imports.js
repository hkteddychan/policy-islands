/* ============ 00 · Three.js loader (CDN primary + fallback) ============
   規格要求：Three.js 改用 jsdelivr，若用戶網絡擋晒 → 自動切 unpkg。
   做法：先 HEAD 探測 primary，失敗就注入指向 fallback 嘅 importmap，
   再用動態 import 載入 core + 4 個 addon（top-level await）。
   ?cdn=fallback 強制走 fallback（測試用）。
   ==================================================================== */
const CDN_BASES = {
  primary: 'https://cdn.jsdelivr.net/npm/three@0.160.0/',
  fallback: 'https://unpkg.com/three@0.160.0/'
};
async function loadThree() {
  const forced = new URLSearchParams(location.search).get('cdn');
  let base = CDN_BASES.primary;
  let viaFallback = false;
  if (forced === 'fallback') {
    base = CDN_BASES.fallback; viaFallback = true;
  } else {
    try {
      const r = await fetch(base + 'build/three.module.js', { method: 'HEAD' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
    } catch (e) {
      base = CDN_BASES.fallback; viaFallback = true;
    }
  }
  // 注入 importmap（head.html 嘅靜態 importmap 已移除，避免兩份 map 優先次序問題）
  const im = document.createElement('script');
  im.type = 'importmap';
  im.textContent = JSON.stringify({
    imports: {
      'three': base + 'build/three.module.js',
      'three/addons/': base + 'examples/jsm/'
    }
  });
  document.head.appendChild(im);

  const [core, controls, css2d, rbox, buf] = await Promise.all([
    import('three'),
    import('three/addons/controls/OrbitControls.js'),
    import('three/addons/renderers/CSS2DRenderer.js'),
    import('three/addons/geometries/RoundedBoxGeometry.js'),
    import('three/addons/utils/BufferGeometryUtils.js')
  ]);
  return {
    THREE: core,
    OrbitControls: controls.OrbitControls,
    CSS2DRenderer: css2d.CSS2DRenderer,
    CSS2DObject: css2d.CSS2DObject,
    RoundedBoxGeometry: rbox.RoundedBoxGeometry,
    mergeGeometries: buf.mergeGeometries,
    CDN: base, viaFallback
  };
}
const { THREE, OrbitControls, CSS2DRenderer, CSS2DObject, RoundedBoxGeometry, mergeGeometries, CDN, viaFallback } = await loadThree();
