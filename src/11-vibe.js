/* ============ 11 · vibe: 島熱度 / 事件重播 / 市長導覽 / UX 改進 ============
   參考 Lifehacker「生活黑客群島」學返嚟嘅 4 樣：
   A. 島熱度 badge —— 每島名牌顯示近期活躍度 + hot 高亮
   B. 事件重播 —— 過去 24 小時發生嘅事（協作 / 加建 / 新聞）逐件喺島上彈出
   C. 市長導覽 —— 有劇本嘅飛行導覽（市政廳 → 各主題島 → 新聞島）
   D. UX —— 手機卡片推畫面上移（viewOffset）+ 名牌 priority 避讓
   靜態版（GitHub Pages）照跑（用 LOG_EVENTS 已有數據），冇後端都唔影響。 */
(function () {
  // ── B. 事件重播 ──────────────────────────────────────────────────
  const replayBar = document.getElementById('replayBar');
  const replayChoice = document.getElementById('replayChoice');
  const replayPos = document.getElementById('replayPos');
  let replayIdx = 0;
  let replayClock = 0;
  let replayOn = false;
  let replayEvents = [];

  function buildReplayPool() {
    // 重播池：LOG_EVENTS（小人協作事件）+ 世界事件 + seed 示範事件
    replayEvents = [];
    if (typeof LOG_EVENTS !== 'undefined') {
      for (const e of LOG_EVENTS) {
        if (!e || !e.txt) continue;
        replayEvents.push({
          icon: e.icon || '🧑‍🤝‍🧑',
          t: e.t,
          text: `${ISL_BY_ID[e.from] ? ISL_BY_ID[e.from].name.zh : ''} → ${ISL_BY_ID[e.to] ? ISL_BY_ID[e.to].name.zh : ''} · ${e.txt}`,
          islandId: e.to || e.from
        });
      }
    }
    // 加埋世界事件（10-gameplay 收集）
    if (window.__gameplay && window.__gameplay.events) {
      for (const ev of window.__gameplay.events) replayEvents.push(ev);
    }
    // seed 示範事件（靜態載入時 LOG_EVENTS 係空 → 用協作線資料生成城市日常）
    if (!replayEvents.length && typeof FLOWS !== 'undefined') {
      const demo = [
        { icon: '🚌', text: '校車路線圖更新，交通島 → 教育島', islandId: 'education' },
        { icon: '🏥', text: '共享健康紀錄轉介，教育島 → 醫療島', islandId: 'health' },
        { icon: '📊', text: '房屋配額數據出爐，房屋島更新數字', islandId: 'housing' },
        { icon: '🌳', text: '綠化建築標準檢討，環境島工作坊', islandId: 'environment' },
        { icon: '💰', text: '稅收影響估算，經濟島完成季度報告', islandId: 'economy' },
        { icon: '🏛️', text: '市政廳收到跨部門協作檔案', islandId: 'hub' },
      ];
      for (const d of demo) {
        replayEvents.push({ icon: d.icon, t: '今日', text: d.text, islandId: d.islandId });
      }
    }
    replayIdx = Math.max(0, replayEvents.length - 30);
  }

  function replayStep() {
    if (!replayOn || !replayEvents.length) return;
    const f = replayEvents[replayIdx % replayEvents.length];
    replayIdx++;
    showReplay(f);
  }

  function showReplay(f) {
    if (!f) return;
    replayBar.querySelector('.ric').textContent = f.icon || '📣';
    replayBar.querySelector('.rt').textContent = f.t || '';
    replayBar.querySelector('.rx').textContent = f.text || '';
    replayBar.classList.add('on');
    clearTimeout(replayBar._h);
    replayBar._h = setTimeout(() => replayBar.classList.remove('on'), 4200);
    // 島 label 閃一下
    if (f.islandId) {
      const L = ISL_MESH[f.islandId] && ISL_MESH[f.islandId].label;
      if (L && L.el) {
        L.el.classList.add('flash');
        setTimeout(() => L.el.classList.remove('flash'), 1600);
      }
    }
    if (typeof STATE !== 'undefined') STATE.dirty = true;
  }

  function toggleReplay(on) {
    replayOn = on !== undefined ? on : !replayOn;
    buildReplayPool();
    if (replayOn) { replayClock = 2.4; replayStep(); }
    if (document.getElementById('tglLog')) {
      const b = document.getElementById('tglLog');
      b.classList.toggle('on', replayOn);
    }
  }
  window.__replay = toggleReplay;

  // ── A. 島熱度 badge ───────────────────────────────────────────────
  // 每島「活躍度」：LOG_EVENTS 出現次數（from/to）+ 世界事件
  const HEAT = {};
  function tallyHeat() {
    HEAT['hub'] = 0;
    for (const I of ISLANDS) HEAT[I.id] = 0;
    if (typeof LOG_EVENTS !== 'undefined') {
      for (const e of LOG_EVENTS) {
        if (e.from && HEAT[e.from] !== undefined) HEAT[e.from]++;
        if (e.to && HEAT[e.to] !== undefined) HEAT[e.to]++;
      }
    }
    if (window.__gameplay && window.__gameplay.events) {
      for (const ev of window.__gameplay.events) {
        if (ev.islandId && HEAT[ev.islandId] !== undefined) HEAT[ev.islandId]++;
      }
    }
    // seed 示範熱度：冇實時事件時，用 FLOWS 協作量推算（官方線 2 點、主題 1 點、規劃 0.5）
    if (!LOG_EVENTS || !LOG_EVENTS.length) {
      for (const f of FLOWS) {
        const w = f.kind === 'official' ? 2 : (f.kind === 'thematic' ? 1 : 0.5);
        if (HEAT[f.from] !== undefined) HEAT[f.from] += w;
        if (HEAT[f.to] !== undefined) HEAT[f.to] += w;
      }
    }
  }
  function updateHeatBadges() {
    tallyHeat();
    // 名牌加數字 + hot（≥4 事件）
    for (const I of ISLANDS) {
      const L = ISL_MESH[I.id] && ISL_MESH[I.id].label;
      if (!L || !L.el) continue;
      let n = L.el.querySelector('.n');
      if (!n) {
        n = document.createElement('span');
        n.className = 'n';
        L.el.appendChild(n);
      }
      const h = HEAT[I.id] || 0;
      n.textContent = h > 0 ? String(h) : '';
      L.el.classList.toggle('hot', h >= 4);
    }
  }

  // ── C. 市長導覽 ──────────────────────────────────────────────────
  const tourBar = document.getElementById('tourBar');
  const tourStepEl = document.getElementById('tourStep');
  const tourTextEl = document.getElementById('tourText');
  let tour = null;
  let tourSavedPause = false;

  function tourSteps() {
    const steps = [];
    steps.push({ home: true, text: '歡迎嚟到政策島！市政廳喺中間，六座主題島圍住佢——交通、教育、醫療、房屋、環境、經濟。每座島都係一個政策範疇，撳入去睇細節。' });
    for (const id of ['transport', 'education', 'health', 'housing', 'environment', 'economy']) {
      const I = ISL_BY_ID[id];
      const items = Object.keys(ITEMS).filter(k => ITEMS[k].isl === id).length;
      const flows = FLOWS.filter(f => f.from === id || f.to === id).length;
      steps.push({
        island: id,
        text: `${I.no} ${I.name.zh}島：${items} 項政策細項、${flows} 條協作線連住其他島。小人會沿住協作線喺島之間搬運政策文件。`
      });
    }
    // 新聞島（如有）
    const newsList = ISLANDS.filter(x => String(x.id).startsWith('news-'));
    if (newsList.length) {
      steps.push({ island: newsList[0].id, text: `呢個係新聞島「${newsList[0].name.zh}」——全港最新政策新聞集中地，最多顯示 5 條熱度最高嘅新聞，支持或認領佢可以 +分！` });
    }
    steps.push({ home: true, text: '呢個城市係活嘅：協作線代表政策之間嘅依賴，小人即刻執行緊。打開「協作線」開關就見到晒。祝你喺政策島玩得開心！' });
    return steps;
  }

  function tourGo(i) {
    const steps = tourSteps();
    if (i < 0 || i >= steps.length) return tourEnd();
    tour = { i, steps };
    tourBar.hidden = false;
    tourStepEl.textContent = `🏛️ 市長導覽 ${i + 1} / ${steps.length}`;
    tourTextEl.textContent = steps[i].text;
    document.getElementById('tourNext').textContent = i === steps.length - 1 ? '完成 ✓' : '下一站 →';
    // 暫停動畫（導覽時唔想世界亂飛）
    if (i === 0 && !Clock.paused) { Clock.paused = true; tourSavedPause = true; document.getElementById('tglPause') && document.getElementById('tglPause').classList.add('on'); }
    // 飛
    if (steps[i].home) {
      select(null, null);
      flyTo(new THREE.Vector3(0, 3, 0), 34.5, 7);
      document.getElementById('card') && (document.getElementById('card').hidden = true);
    } else if (steps[i].island) {
      const id = steps[i].island;
      select('island', id);
      document.getElementById('card') && (document.getElementById('card').hidden = false);
    }
    if (typeof STATE !== 'undefined') STATE.dirty = true;
  }
  function tourEnd() {
    tour = null;
    tourBar.hidden = true;
    if (tourSavedPause) {
      Clock.paused = false;
      document.getElementById('tglPause') && document.getElementById('tglPause').classList.remove('on');
      tourSavedPause = false;
    }
    select(null, null);
    flyTo(new THREE.Vector3(0, 3, 0), 34.5, 7);
    if (typeof STATE !== 'undefined') STATE.dirty = true;
  }
  document.getElementById('btnTour').addEventListener('click', () => tourGo(0));
  document.getElementById('tourNext').addEventListener('click', () => tourGo(tour ? tour.i + 1 : 0));
  document.getElementById('tourPrev').addEventListener('click', () => tourGo(tour ? Math.max(0, tour.i - 1) : 0));
  document.getElementById('tourExit').addEventListener('click', tourEnd);

  // ── D. UX：手機卡片推畫面上移 + 名牌 priority ────────────────────
  // 用 08-boot 嘅 window.__onResize hook（唔覆寫原 resize）
  function resizeVibe(w, h) {
    const mobile = w <= 800;
    const cardOpen = mobile && !document.getElementById('card').hidden;
    const sideOpen = mobile && !document.getElementById('side').hidden;
    if (mobile && (cardOpen || sideOpen)) {
      const offY = cardOpen ? h * 0.26 : h * 0.18;
      camera.setViewOffset(w, h, 0, offY, w, h);
    } else {
      camera.clearViewOffset();
    }
    camera.updateProjectionMatrix();
  }
  window.__onResize = resizeVibe;
  if (typeof STATE !== 'undefined') STATE.dirty = true;

  // 名牌 priority：遠鏡 + 熱島優先顯示（用 06-select 嘅 window.__onLabels hook）
  function labelsVibe() {
    const dist = camera.position.distanceTo(controls.target);
    if (dist > 46) {
      for (const I of ISLANDS) {
        const L = ISL_MESH[I.id] && ISL_MESH[I.id].label;
        if (!L || !L.el) continue;
        const hot = (HEAT[I.id] || 0) >= 4;
        const sel = SEL.kind === 'island' && SEL.id === I.id;
        if (!hot && !sel) L.el.classList.add('far');
        else L.el.classList.remove('far');
      }
    } else {
      for (const I of ISLANDS) {
        const L = ISL_MESH[I.id] && ISL_MESH[I.id].label;
        if (L && L.el) L.el.classList.remove('far');
      }
    }
  }
  window.__onLabels = labelsVibe;

  // ── boot：將重播/熱度接入主迴圈 ──────────────────────────────────
  function vibeTick(dt) {
    if (!replayOn || tour) return;
    replayClock += dt;
    if (replayClock > 2.8) { replayClock = 0; replayStep(); }
  }
  window.__vibeTick = vibeTick;
  window.__updateHeatBadges = updateHeatBadges;
  window.__buildReplayPool = buildReplayPool;

  // 初始：建立重播池 + 熱度徽章（延遲至世界就緒）
  setTimeout(() => {
    buildReplayPool();
    updateHeatBadges();
    // 有 LOG_EVENTS 就自動開重播（唔騷擾，只開一次）
    if (replayEvents.length) toggleReplay(true);
  }, 2500);
})();