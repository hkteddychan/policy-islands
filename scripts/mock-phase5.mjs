#!/usr/bin/env node
/* 本地 mock Cloudflare Worker + Durable Object（node:sqlite）→ 供 verify-phase5.mjs 用
   用法：node scripts/mock-phase5.mjs [port] */
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = Number(process.argv[2] || 8792);

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(path.join(ROOT, 'migrations', '0001_init.sql'), 'utf8'));
if (existsSync(path.join(ROOT, 'migrations', '0002_seed.sql'))) {
  db.exec(readFileSync(path.join(ROOT, 'migrations', '0002_seed.sql'), 'utf8'));
}

const PROPOSAL_THRESHOLD = 5;
const TASKS = [
  { id: 'build', label: { zh: '加一座建築', en: 'Add a building' }, target: 1 },
  { id: 'news', label: { zh: '探訪 3 個新聞島', en: 'Visit 3 news islands' }, target: 3 },
  { id: 'flow', label: { zh: '查看一條協作線', en: 'View a collaboration flow' }, target: 1 },
  { id: 'vote', label: { zh: '投票支持一個提案', en: 'Vote for a proposal' }, target: 1 },
];
const MODEL_WHITELIST = new Set(['busstop','tram','starferry','chaChaan','temple','market','tonglau','estate','skyscraper','pawnshop','cinema','jockey','clinic','classroom','cottage','stall','lighthouse','kcr','mahjong','pavilion','bike','terminal','school','hospital','park','factory','tower']);

// users.score 係 runtime ALTER 加出嚟嘅（world-room.js 兼容舊表做法）→ mock 要一樣
try { db.exec('ALTER TABLE users ADD COLUMN score INTEGER DEFAULT 0'); } catch (e) {}
// Phase 5 新表
db.exec(`
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY, island_id TEXT NOT NULL, name_zh TEXT NOT NULL, name_en TEXT,
  model TEXT NOT NULL, creator_token TEXT, votes_for INTEGER NOT NULL DEFAULT 0,
  votes_against INTEGER NOT NULL DEFAULT 0, voters TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, decided_at INTEGER
);
CREATE TABLE IF NOT EXISTS island_votes (
  island_id TEXT NOT NULL, token_hash TEXT NOT NULL, kind TEXT NOT NULL,
  created_at INTEGER NOT NULL, PRIMARY KEY (island_id, token_hash, kind)
);
CREATE TABLE IF NOT EXISTS task_state (
  token_hash TEXT NOT NULL, day TEXT NOT NULL, task_id TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (token_hash, day, task_id)
);`);

let seq = 0;
const rateLimits = new Map();
const tokens = new Map();   // token -> hash

async function sha256Hex(text) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text || '')));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function nextSeq() {
  seq += 1;
  db.prepare("INSERT OR REPLACE INTO world_meta (k,v) VALUES ('seq', ?)").run(String(seq));
  return seq;
}

function bumpTask(hash, taskId) {
  const t = TASKS.find(x => x.id === taskId);
  if (!t || !hash) return;
  const day = new Date().toISOString().slice(0, 10);
  db.prepare('INSERT OR IGNORE INTO task_state (token_hash, day, task_id, progress, done) VALUES (?,?,?,0,0)').run(hash, day, taskId);
  const row = db.prepare('SELECT progress, done FROM task_state WHERE token_hash = ? AND day = ? AND task_id = ?').get(hash, day, taskId);
  if (!row || row.done) return;
  const prog = Math.min(t.target, row.progress + 1);
  const done = prog >= t.target ? 1 : 0;
  db.prepare('UPDATE task_state SET progress = ?, done = ? WHERE token_hash = ? AND day = ? AND task_id = ?').run(prog, done, hash, day, taskId);
  if (done && !row.done) db.prepare('UPDATE users SET score = score + 15 WHERE token_hash = ?').run(hash);
}

function validate(type, payload) {
  if (type === 'add_item') {
    const it = payload.item || {};
    if (!it.id || !/^[a-z][a-z0-9\-]{1,31}$/.test(it.id)) return 'item.id invalid';
    const isl = db.prepare('SELECT id FROM islands WHERE id = ? AND deleted_at IS NULL').get(it.islandId);
    if (!isl) return 'island not found';
    if (!MODEL_WHITELIST.has(it.model)) return 'model not allowed';
    if (!it.name?.zh || it.name.zh.length > 24) return 'name_zh 1-24 chars';
    return null;
  }
  if (type === 'add_island') {
    const isl = payload.island || {};
    if (!isl.id || !/^news-[0-9]{8}\-[0-9]{2}$/.test(isl.id)) return 'island.id must be news-YYYYMMDD-NN';
    if (!isl.name?.zh || isl.name.zh.length > 60) return 'name_zh 1-60 chars';
    return null;
  }
  if (type === 'add_flow') return null;
  if (type === 'create_proposal') {
    const pr = payload.proposal || {};
    if (!pr.id || !/^p-[0-9]{8}-[a-z0-9]{4}$/.test(pr.id)) return 'proposal.id must be p-YYYYMMDD-xxxx';
    if (!pr.islandId) return 'proposal.islandId required';
    const isl = db.prepare('SELECT id FROM islands WHERE id = ? AND deleted_at IS NULL').get(pr.islandId);
    if (!isl) return 'island not found';
    if (!MODEL_WHITELIST.has(pr.model)) return 'model not allowed';
    if (!pr.name?.zh || pr.name.zh.length > 24) return 'name_zh 1-24 chars';
    return null;
  }
  if (type === 'vote_proposal') {
    const v = payload.vote || {};
    if (!v.proposalId) return 'vote.proposalId required';
    if (v.dir !== 'for' && v.dir !== 'against') return 'vote.dir must be for|against';
    return null;
  }
  if (type === 'vote_island') {
    const v = payload.vote || {};
    if (!v.islandId) return 'vote.islandId required';
    if (v.kind !== 'support' && v.kind !== 'claim') return 'vote.kind must be support|claim';
    return null;
  }
  if (type === 'task_progress') {
    const t = payload.taskId;
    if (!t || !TASKS.some(x => x.id === t)) return 'taskId invalid';
    return null;
  }
  return 'unknown mutation type: ' + type;
}

function applyMutation(type, payload, now, hash) {
  if (type === 'add_item') {
    const it = payload.item;
    db.prepare(`INSERT OR REPLACE INTO items (id, island_id, no, model, name_zh, name_en, facts_json, timeline_json, src, freq, created_at, created_by, deleted_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)`).run(
      it.id, it.islandId, it.no ?? 99, it.model, it.name.zh, it.name.en || it.name.zh,
      JSON.stringify(it.facts || []), JSON.stringify(it.timeline || []),
      it.src || '市民提案', it.freq || '即時', now, hash);
    if (hash) db.prepare('UPDATE users SET score = score + 10, last_seen = ? WHERE token_hash = ?').run(now, hash);
    bumpTask(hash, 'build');
    return { ok: true };
  }
  if (type === 'add_island') {
    const isl = payload.island;
    db.prepare(`INSERT OR REPLACE INTO islands (id, no, theme, name_zh, name_en, summary_zh, summary_en, icon, color, ang, radius, origin, news_id, created_at, created_by, deleted_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`).run(
      isl.id, isl.no ?? '99', isl.theme || 'news', isl.name.zh, isl.name.en || isl.name.zh,
      isl.summary?.zh || '', isl.summary?.en || '', isl.icon || '📰', isl.color ?? 0x9cc27a,
      isl.ang ?? null, isl.radius ?? 32, 'news', isl.newsId || null, now, hash);
    const itemId = isl.id + '-i1';
    db.prepare(`INSERT OR REPLACE INTO items (id, island_id, no, model, name_zh, name_en, facts_json, timeline_json, src, freq, created_at, created_by, deleted_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)`).run(
      itemId, isl.id, 1, isl.itemModel || 'pavilion', isl.name.zh + ' · 焦點', isl.name.en || isl.name.zh,
      JSON.stringify([{ v: 'NEW', u: { zh: '島' }, k: { zh: '新聞島' } }]),
      JSON.stringify([{ d: 'now', t: { zh: '由新聞自動生成' } }]),
      '新聞自動生成', '即時', now, hash);
    return { ok: true };
  }
  if (type === 'add_flow') {
    const f = payload.flow;
    db.prepare(`INSERT OR REPLACE INTO flows (id, from_island, to_island, kind, ev, updated, depts, carry_zh, carry_en, icon, note_zh, note_en, created_at, created_by, deleted_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`).run(
      f.id, f.from, f.to, f.kind || 'pending', f.ev || 'C', '2026 Q4', f.depts ?? 1,
      f.carry?.zh || '待定', f.carry?.en || 'TBD', f.icon || '📄', f.note?.zh || '', f.note?.en || '', now, hash);
    return { ok: true };
  }
  if (type === 'create_proposal') {
    const pr = payload.proposal;
    if (db.prepare('SELECT id FROM proposals WHERE id = ?').get(pr.id)) return { ok: false, error: 'proposal already exists' };
    db.prepare(`INSERT INTO proposals (id, island_id, name_zh, name_en, model, creator_token, votes_for, votes_against, voters, status, created_at)
      VALUES (?,?,?,?,?,?,0,0,'[]','pending',?)`).run(
      pr.id, pr.islandId, pr.name.zh, pr.name.en || pr.name.zh, pr.model, hash, now);
    if (hash) db.prepare('UPDATE users SET score = score + 2 WHERE token_hash = ?').run(hash);
    return { ok: true };
  }
  if (type === 'vote_proposal') {
    const v = payload.vote;
    const pr = db.prepare('SELECT * FROM proposals WHERE id = ?').get(v.proposalId);
    if (!pr) return { ok: false, error: 'proposal not found' };
    if (pr.status !== 'pending') return { ok: false, error: 'proposal already ' + pr.status };
    let voters = []; try { voters = JSON.parse(pr.voters || '[]'); } catch {}
    if (hash && voters.includes(hash)) return { ok: false, error: 'already voted' };
    if (hash) voters.push(hash);
    db.prepare('UPDATE proposals SET votes_for = votes_for + ?, votes_against = votes_against + ?, voters = ? WHERE id = ?')
      .run(v.dir === 'for' ? 1 : 0, v.dir === 'against' ? 1 : 0, JSON.stringify(voters), v.proposalId);
    const after = db.prepare('SELECT votes_for, votes_against FROM proposals WHERE id = ?').get(v.proposalId);
    let status = 'pending';
    if (after.votes_for >= PROPOSAL_THRESHOLD) status = 'approved';
    else if (after.votes_for + after.votes_against >= 20) status = 'rejected';
    db.prepare('UPDATE proposals SET status = ?, decided_at = ? WHERE id = ?').run(status, status === 'pending' ? null : now, v.proposalId);
    if (status === 'approved') {
      const itemId = 'pr-' + v.proposalId.slice(2) + '-item';
      if (!db.prepare('SELECT id FROM items WHERE id = ?').get(itemId)) {
        const c = db.prepare('SELECT COUNT(*) AS c FROM items WHERE island_id = ? AND deleted_at IS NULL').get(pr.island_id);
        const no = (c?.c || 0) + 1;
        db.prepare(`INSERT INTO items (id, island_id, no, model, name_zh, name_en, facts_json, timeline_json, src, freq, created_at, created_by, deleted_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)`).run(
          itemId, pr.island_id, no, pr.model, pr.name_zh, pr.name_en || pr.name_zh,
          JSON.stringify([{ v: 'PASS', u: { zh: '議' }, k: { zh: '市民投票通過' } }]),
          JSON.stringify([{ d: 'now', t: { zh: '投票通過，即時落實' } }]),
          '市民投票通過', '即時', now, pr.creator_token);
      }
      if (pr.creator_token) db.prepare('UPDATE users SET score = score + 20 WHERE token_hash = ?').run(pr.creator_token);
    }
    if (hash) db.prepare('UPDATE users SET score = score + 1 WHERE token_hash = ?').run(hash);
    bumpTask(hash, 'vote');
    return { ok: true };
  }
  if (type === 'task_progress') {
    bumpTask(hash, payload.taskId);
    return { ok: true };
  }
  if (type === 'vote_island') {
    const v = payload.vote;
    const isl = db.prepare('SELECT id, created_at FROM islands WHERE id = ? AND deleted_at IS NULL').get(v.islandId);
    if (!isl) return { ok: false, error: 'island not found' };
    if (v.kind === 'claim') {
      if (isl.created_at && Date.now() - isl.created_at > 3 * 86400000) return { ok: false, error: 'claim window closed (3 days)' };
      const dup = db.prepare('SELECT 1 FROM island_votes WHERE island_id = ? AND token_hash = ? AND kind = ?').get(v.islandId, hash || '', v.kind);
      if (dup) return { ok: false, error: 'already claimed' };
      db.prepare('INSERT OR REPLACE INTO island_votes (island_id, token_hash, kind, created_at) VALUES (?,?,?,?)').run(v.islandId, hash || '', v.kind, Date.now());
      db.prepare('UPDATE islands SET created_by = ? WHERE id = ?').run(hash, v.islandId);
      if (hash) db.prepare('UPDATE users SET score = score + 25 WHERE token_hash = ?').run(hash);
      return { ok: true };
    }
    const dup = db.prepare('SELECT 1 FROM island_votes WHERE island_id = ? AND token_hash = ? AND kind = ?').get(v.islandId, hash || '', v.kind);
    if (dup) return { ok: false, error: 'already supported' };
    db.prepare('INSERT OR REPLACE INTO island_votes (island_id, token_hash, kind, created_at) VALUES (?,?,?,?)').run(v.islandId, hash || '', v.kind, Date.now());
    if (hash) db.prepare('UPDATE users SET score = score + 1 WHERE token_hash = ?').run(hash);
    return { ok: true };
  }
  return { ok: false, error: 'unknown type' };
}

function getWorld() {
  const islands = db.prepare('SELECT * FROM islands WHERE deleted_at IS NULL').all();
  const items = db.prepare('SELECT * FROM items WHERE deleted_at IS NULL').all();
  const flows = db.prepare('SELECT * FROM flows WHERE deleted_at IS NULL').all();
  return {
    seq,
    islands: islands.map(i => ({ id: i.id, no: i.no, theme: i.theme, name: { zh: i.name_zh, en: i.name_en }, summary: { zh: i.summary_zh, en: i.summary_en }, icon: i.icon, color: i.color, ang: i.ang, radius: i.radius, origin: i.origin, newsId: i.news_id, createdAt: i.created_at })),
    items: items.map(it => ({ id: it.id, islandId: it.island_id, no: it.no, model: it.model, name: { zh: it.name_zh, en: it.name_en }, facts: JSON.parse(it.facts_json || '[]'), timeline: JSON.parse(it.timeline_json || '[]'), src: it.src, freq: it.freq })),
    flows: flows.map(f => ({ id: f.id, from: f.from_island, to: f.to_island, kind: f.kind, ev: f.ev, updated: f.updated, depts: f.depts, carry: { zh: f.carry_zh, en: f.carry_en }, icon: f.icon, note: { zh: f.note_zh, en: f.note_en } })),
  };
}

function json(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(s);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const method = req.method;

  // 靜態檔（供瀏覽器實測 index.html）
  if (method === 'GET' && !p.startsWith('/api/')) {
    const fp = path.join(ROOT, p === '/' ? 'index.html' : p.replace(/^\//, ''));
    if (existsSync(fp) && !fp.endsWith('/')) {
      const buf = readFileSync(fp);
      res.writeHead(200, { 'Content-Type': fp.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
      res.end(buf);
      return;
    }
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  let input = null;
  try { input = body ? JSON.parse(body) : null; } catch {}

  try {
    if (p === '/api/session' && method === 'POST') {
      const token = 'pi_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      const hash = await sha256Hex(token);
      tokens.set(token, hash);
      // 同 world-room.js 一致：id = 'u_' + hash[:10]，kind = 'anonymous'，handle NULL
      db.prepare('INSERT OR REPLACE INTO users (id, handle, kind, token_hash, created_at, last_seen, score) VALUES (?,?,?,?,?,?,?)')
        .run('u_' + hash.slice(0, 10), null, 'anonymous', hash, Date.now(), Date.now(), 0);
      return json(res, 200, { token });
    }
    if (p === '/api/world') return json(res, 200, getWorld());
    if (p === '/api/proposals') {
      const rows = db.prepare('SELECT id, island_id, name_zh, name_en, model, votes_for, votes_against, status, created_at FROM proposals ORDER BY created_at DESC LIMIT 100').all();
      return json(res, 200, { ok: true, threshold: PROPOSAL_THRESHOLD, proposals: rows.map(r => ({ id: r.id, islandId: r.island_id, name: { zh: r.name_zh, en: r.name_en }, model: r.model, votesFor: r.votes_for, votesAgainst: r.votes_against, status: r.status, createdAt: r.created_at })) });
    }
    if (p === '/api/island-votes') {
      const rows = db.prepare('SELECT island_id, kind, COUNT(*) AS c FROM island_votes GROUP BY island_id, kind').all();
      const map = {};
      for (const r of rows) { if (!map[r.island_id]) map[r.island_id] = { support: 0, claim: 0 }; map[r.island_id][r.kind] = r.c; }
      return json(res, 200, { ok: true, votes: map });
    }
    if (p === '/api/tasks') {
      const auth = req.headers.authorization || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!token) return json(res, 401, { error: 'session token required' });
      const hash = await sha256Hex(token);
      const day = new Date().toISOString().slice(0, 10);
      const rows = db.prepare('SELECT task_id, progress, done FROM task_state WHERE token_hash = ? AND day = ?').all(hash, day);
      return json(res, 200, { ok: true, day, tasks: TASKS.map(t => { const r = rows.find(x => x.task_id === t.id); return { id: t.id, label: t.label, target: t.target, progress: r ? r.progress : 0, done: r ? r.done : 0 }; }) });
    }
    if (p === '/api/leaderboard') {
      const rows = db.prepare("SELECT COALESCE(handle, '匿名市民') AS handle, score FROM users WHERE score > 0 ORDER BY score DESC LIMIT 50").all();
      return json(res, 200, { leaderboard: rows });
    }
    if (p === '/api/mutations' && method === 'POST') {
      const auth = req.headers.authorization || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!token || !tokens.has(token)) return json(res, 401, { error: 'invalid or missing session token' });
      const hash = await sha256Hex(token);
      if (!input?.type || !input?.payload) return json(res, 400, { error: 'type and payload required' });
      // rate limit
      const now = Date.now();
      const rl = rateLimits.get(hash) || { count: 0, window: 0 };
      if (now - rl.window > 60000) { rl.window = now; rl.count = 0; }
      if (rl.count >= 5) return json(res, 429, { error: 'rate limit exceeded: max 5 mutations per minute' });
      rl.count++; rateLimits.set(hash, rl);
      const err = validate(input.type, input.payload);
      if (err) return json(res, 400, { error: err });
      const s = nextSeq();
      db.prepare('INSERT INTO mutations (seq, type, payload_json, actor_token, created_at) VALUES (?,?,?,?,?)').run(s, input.type, JSON.stringify(input.payload), hash, now);
      const r = applyMutation(input.type, input.payload, now, hash);
      if (!r.ok) return json(res, 400, { error: r.error });
      return json(res, 200, { ok: true, seq: s });
    }
    if (p === '/api/mutations') {
      const since = Number(url.searchParams.get('since') || 0);
      const rows = db.prepare('SELECT seq, type, payload_json, actor_token, created_at FROM mutations WHERE seq > ? ORDER BY seq').all(since);
      return json(res, 200, { seq, mutations: rows.map(r => ({ seq: r.seq, type: r.type, payload: JSON.parse(r.payload_json), actorToken: r.actor_token, createdAt: r.created_at })) });
    }
    if (p === '/api/health') return json(res, 200, { ok: true, version: 'phase5-mock', backend: 'mock-do', world: 'ready' });
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    console.error('mock error:', e);
    return json(res, 500, { error: String(e && e.message) });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`mock-phase5 listening on ${PORT}`));
