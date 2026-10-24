#!/usr/bin/env node
/* Phase 5 驗收：市民提案投票 / what-if / 每日任務 / 新聞島認領
   用法：node scripts/verify-phase5.mjs [baseUrl]
   預設打本地 mock server（scripts/mock-phase5.mjs） */
import { spawn } from 'node:child_process';

const BASE = process.argv[2] || 'http://127.0.0.1:8792';
let pass = 0, fail = 0;
const results = [];

function check(name, cond, detail) {
  if (cond) { pass++; results.push(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; results.push(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

async function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  if (opts.token) headers['Authorization'] = 'Bearer ' + opts.token;
  if (opts.body) headers['Content-Type'] = 'application/json';
  const r = await fetch(BASE + path, Object.assign({}, opts, { headers }));
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { ok: r.ok, status: r.status, data, text };
}

async function main() {
  console.log(`\n=== Phase 5 驗收 → ${BASE} ===\n`);

  // ── 0. session ──────────────────────────────────────────────────────
  const s1 = await api('/api/session', { method: 'POST' });
  check('建立匿名 session', s1.ok && !!s1.data?.token, s1.data?.token ? 'token OK' : s1.text.slice(0, 80));
  const tokA = s1.data?.token;
  const s2 = await api('/api/session', { method: 'POST' });
  const tokB = s2.data?.token;
  check('兩個獨立 session', tokA && tokB && tokA !== tokB);

  // ── A. 市民提案投票 ────────────────────────────────────────────────
  const world = await api('/api/world');
  check('world 讀取', world.ok && !!world.data?.islands, `${world.data?.islands?.length} 島`);
  const islId = world.data.islands[1].id;

  const pid = 'p-20261024-tst1';
  const cr = await api('/api/mutations', {
    method: 'POST', token: tokA,
    body: JSON.stringify({ type: 'create_proposal', payload: { proposal: { id: pid, islandId: islId, model: 'pavilion', name: { zh: '測試涼亭', en: 'Test Pavilion' } } } })
  });
  check('建立提案', cr.ok, `seq ${cr.data?.seq} ${cr.text.slice(0, 60)}`);

  // 提案唔應該即刻落世界（item 唔存在）
  const w2 = await api('/api/world');
  const itemNow = (w2.data.items || []).find(i => i.id.includes('20261024-tst1'));
  check('提案未投票前唔落世界', !itemNow, itemNow ? 'BUG: 已出現' : 'OK');

  // 5 個支持票（4 個唔同 token + 1 個）→ 通過
  const tokens = [tokA];
  for (let i = 0; i < 4; i++) {
    const s = await api('/api/session', { method: 'POST' });
    tokens.push(s.data.token);
  }
  let votesOk = 0;
  for (const t of tokens) {
    const v = await api('/api/mutations', {
      method: 'POST', token: t,
      body: JSON.stringify({ type: 'vote_proposal', payload: { vote: { proposalId: pid, dir: 'for' } } })
    });
    if (v.ok) votesOk++;
  }
  check('5 個支持票全部成功', votesOk === 5, `${votesOk}/5`);

  const props = await api('/api/proposals');
  const p = (props.data?.proposals || []).find(x => x.id === pid);
  check('提案狀態 = approved', p?.status === 'approved', `status=${p?.status} votesFor=${p?.votesFor}`);
  check('門檻 = 5', props.data?.threshold === 5, `threshold=${props.data?.threshold}`);

  // 通過後 item 應該出現
  const w3 = await api('/api/world');
  const itemAfter = (w3.data.items || []).find(i => i.id.includes('20261024-tst1'));
  check('通過後正式落世界', !!itemAfter, itemAfter ? `item ${itemAfter.id}` : 'MISSING');

  // 重複投票應該被拒
  const dup = await api('/api/mutations', {
    method: 'POST', token: tokens[0],
    body: JSON.stringify({ type: 'vote_proposal', payload: { vote: { proposalId: pid, dir: 'for' } } })
  });
  check('重複投票被拒', !dup.ok, dup.data?.error || `HTTP ${dup.status}`);

  // ── C. 每日任務 ────────────────────────────────────────────────────
  const t1 = await api('/api/tasks', { token: tokA });
  check('tasks 端點（需 token）', t1.ok && Array.isArray(t1.data?.tasks), `${t1.data?.tasks?.length} tasks`);
  const tNo = await api('/api/tasks');
  check('tasks 冇 token → 401', !tNo.ok && tNo.status === 401, `HTTP ${tNo.status}`);
  const buildTask = (t1.data?.tasks || []).find(t => t.id === 'build');
  check('build 任務有進度（投票者加過建築）', !!buildTask, JSON.stringify(buildTask));

  // ── C2. task_progress mutation ─────────────────────────────────────
  const tp = await api('/api/mutations', {
    method: 'POST', token: tokA,
    body: JSON.stringify({ type: 'task_progress', payload: { taskId: 'flow' } })
  });
  check('task_progress mutation', tp.ok, tp.data?.error || 'OK');
  const t2 = await api('/api/tasks', { token: tokA });
  const flowTask = (t2.data?.tasks || []).find(t => t.id === 'flow');
  check('flow 任務進度已記錄', flowTask && flowTask.progress >= 1, JSON.stringify(flowTask));
  const tpBad = await api('/api/mutations', {
    method: 'POST', token: tokA,
    body: JSON.stringify({ type: 'task_progress', payload: { taskId: 'nope' } })
  });
  check('task_progress 非法 taskId 被拒', !tpBad.ok, tpBad.data?.error || `HTTP ${tpBad.status}`);

  // ── D. 新聞島認領 + 支持 ───────────────────────────────────────────
  const iv = await api('/api/island-votes');
  check('island-votes 端點', iv.ok && !!iv.data?.votes, JSON.stringify(iv.data?.votes || {}).slice(0, 70));

  // 造一個新聞島（用全新 token，避開 tokA 已用盡嘅 5 次限流）
  const tokC = (await api('/api/session', { method: 'POST' })).data.token;
  const tokD = (await api('/api/session', { method: 'POST' })).data.token;
  const nid = 'news-20261024-01';
  const ni = await api('/api/mutations', {
    method: 'POST', token: tokC,
    body: JSON.stringify({ type: 'add_island', payload: { island: { id: nid, name: { zh: '測試新聞島', en: 'Test News' }, theme: 'news' } } })
  });
  check('新增新聞島', ni.ok, `seq ${ni.data?.seq}`);
  const claim = await api('/api/mutations', {
    method: 'POST', token: tokC,
    body: JSON.stringify({ type: 'vote_island', payload: { vote: { islandId: nid, kind: 'claim' } } })
  });
  check('認領新聞島', claim.ok, claim.data?.error || 'OK');
  const claim2 = await api('/api/mutations', {
    method: 'POST', token: tokC,
    body: JSON.stringify({ type: 'vote_island', payload: { vote: { islandId: nid, kind: 'claim' } } })
  });
  check('重複認領被拒', !claim2.ok, claim2.data?.error || `HTTP ${claim2.status}`);
  const sup = await api('/api/mutations', {
    method: 'POST', token: tokD,
    body: JSON.stringify({ type: 'vote_island', payload: { vote: { islandId: nid, kind: 'support' } } })
  });
  check('支持新聞島', sup.ok, sup.data?.error || 'OK');
  const iv2 = await api('/api/island-votes');
  const vv = iv2.data?.votes?.[nid];
  // 用 delta 比較（測試可重複執行：mock DB 會累積舊票）
  const before = iv.data?.votes?.[nid] || { support: 0, claim: 0 };
  check('島票數統計正確（delta）',
    vv && vv.support === before.support + 1 && vv.claim === before.claim + 1,
    JSON.stringify(vv) + ' vs before ' + JSON.stringify(before));

  // ── 分數 / 排行榜 ──────────────────────────────────────────────────
  const lb = await api('/api/leaderboard');
  check('排行榜有資料', lb.ok && (lb.data?.leaderboard || []).length > 0, `${lb.data?.leaderboard?.length} 人`);
  const top = (lb.data?.leaderboard || [])[0];
  check('最高分 ≥ 20（提案人 +20）', top && top.score >= 20, `top=${top?.score}`);

  // ── 限流 ──────────────────────────────────────────────────────────
  let rl = 0;
  for (let i = 0; i < 8; i++) {
    const r = await api('/api/mutations', {
      method: 'POST', token: tokB,
      body: JSON.stringify({ type: 'vote_island', payload: { vote: { islandId: nid, kind: 'support' } } })
    });
    if (!r.ok && r.status === 429) rl++;
  }
  check('限流生效（429）', rl > 0, `${rl}/8 被限流`);

  // ── 審計 log ───────────────────────────────────────────────────────
  const muts = await api('/api/mutations?since=0');
  const types = [...new Set((muts.data?.mutations || []).map(m => m.type))];
  check('審計 log 記錄新 type', types.includes('create_proposal') && types.includes('vote_proposal') && types.includes('vote_island'), types.join(','));

  console.log(results.join('\n'));
  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
