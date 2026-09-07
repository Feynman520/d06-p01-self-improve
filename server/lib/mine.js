// Session-transcript mining (local only): user corrections, tool errors, repeated tool loops.
// Parsers for Claude Code (`projects/**/*.jsonl`) and Codex (`sessions/**/rollout-*.jsonl`).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createInterface } from 'node:readline';
import { readJson, writeJson, queueDir, listRecords, updateRecord } from './store.js';
import { normalizePath } from './paths.js';

export const CORRECTION_RE = /(아니(야|요|라|다|,|\.|고)|그게 아니|그거 말고|다시 (해|만들|하|짜|써|고쳐)|잘못|틀렸|왜 .{0,24}(했|한|됐)|하지 ?마|앞으로는|앞으로 .{0,20}(항상|꼭|반드시)|no,? not that|do it again|that'?s wrong|not what i|instead|from now on|don'?t (do|use|make))/i;
export const ERROR_RE = /(^|\n)\s*(error|Error:|ERR!|Traceback|Exception|fatal:|command not found|is not recognized|ENOENT|EACCES|EPERM|Permission denied|실패|오류)/m;
const MAX_USER_LEN = 400;
const EXCERPT = 320;
const QUEUE_MAX = 50;
const QUEUE_MAX_LOOPS = 5;
const LOOP_MIN_SESSIONS = 5;

const stateFile = (base) => path.join(base, 'mine-state.json');
const queueFile = (base) => path.join(queueDir(base), 'pending.json');
const emptyState = () => ({ files: {}, sessions: {}, ngrams: {}, dismissed: [], last_run: null });
export const loadState = (base) => readJson(stateFile(base), emptyState());
export const loadQueue = (base) => readJson(queueFile(base), []);
const saveQueue = (base, q) => writeJson(queueFile(base), q);

const clip = (s, n = EXCERPT) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x === 'string' ? x : x.text || '')).join('\n') : '');

async function eachLine(file, fn) {
  const rl = createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    fn(o);
  }
}

export async function parseClaude(file) {
  const s = { agent: 'claude', session_id: '', cwd: '', start: '', end: '', turns: [] };
  await eachLine(file, (o) => {
    if (o.sessionId && !s.session_id) s.session_id = o.sessionId;
    if (o.cwd && !s.cwd) s.cwd = o.cwd;
    if (o.timestamp) { if (!s.start) s.start = o.timestamp; s.end = o.timestamp; }
    if (o.isSidechain) return;
    const msg = o.message;
    if (!msg) return;
    if (o.type === 'user') {
      if (typeof msg.content === 'string') s.turns.push({ role: 'user', text: msg.content, ts: o.timestamp });
      else if (Array.isArray(msg.content)) {
        for (const it of msg.content) {
          if (it.type === 'text') s.turns.push({ role: 'user', text: it.text || '', ts: o.timestamp });
          else if (it.type === 'tool_result') s.turns.push({ role: 'tool', text: textOf(it.content), is_error: !!it.is_error, ts: o.timestamp });
        }
      }
    } else if (o.type === 'assistant' && Array.isArray(msg.content)) {
      for (const it of msg.content) {
        if (it.type === 'text') s.turns.push({ role: 'assistant', text: it.text || '', ts: o.timestamp });
        else if (it.type === 'tool_use') s.turns.push({ role: 'tool_use', tool: it.name, ts: o.timestamp });
      }
    }
  });
  return s;
}

export async function parseCodex(file) {
  const s = { agent: 'codex', session_id: '', cwd: '', start: '', end: '', turns: [] };
  await eachLine(file, (o) => {
    if (o.timestamp) { if (!s.start) s.start = o.timestamp; s.end = o.timestamp; }
    const p = o.payload || {};
    if (o.type === 'session_meta') { s.session_id = p.session_id || p.id || ''; s.cwd = p.cwd || ''; return; }
    if (o.type === 'turn_context' && p.cwd && !s.cwd) { s.cwd = p.cwd; return; }
    if (o.type !== 'response_item') return;
    if (p.type === 'message') {
      const texts = (p.content || []).map((c) => c.text || '').filter((t) => t && !t.startsWith('<'));
      if (!texts.length) return;
      if (p.role === 'user') s.turns.push({ role: 'user', text: texts.join('\n'), ts: o.timestamp });
      else if (p.role === 'assistant') s.turns.push({ role: 'assistant', text: texts.join('\n'), ts: o.timestamp });
    } else if (p.type === 'function_call' || p.type === 'custom_tool_call') {
      s.turns.push({ role: 'tool_use', tool: p.name || 'tool', ts: o.timestamp });
    } else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
      s.turns.push({ role: 'tool', text: textOf(p.output), is_error: false, ts: o.timestamp });
    }
  });
  return s;
}

export function extract(session) {
  const cands = [];
  const seenTools = new Set();
  let lastAssistant = '';
  let lastTool = '';
  let userSeen = 0;
  const seq = [];
  const push = (kind, excerpt, extra = {}) => cands.push({
    id: 'C-' + crypto.createHash('sha1').update(kind + '|' + excerpt.toLowerCase()).digest('hex').slice(0, 8),
    kind, agent: session.agent, session: session.session_id, cwd: session.cwd, excerpt, ...extra,
  });
  for (const t of session.turns) {
    if (t.role === 'assistant') lastAssistant = t.text;
    else if (t.role === 'tool_use') { lastTool = t.tool; seq.push(t.tool); }
    else if (t.role === 'user') {
      userSeen++;
      const text = String(t.text || '').trim();
      if (userSeen > 1 && text && text.length <= MAX_USER_LEN && !text.startsWith('/') && CORRECTION_RE.test(text)) {
        push('correction', `[에이전트] ${clip(lastAssistant, 200)}\n[사용자] ${clip(text, 300)}`, { ts: t.ts, suggested_category: /앞으로|from now on|항상|always/i.test(text) ? '지식 부족' : '오해' });
      }
    } else if (t.role === 'tool') {
      const head = String(t.text || '').slice(0, 400);
      if ((t.is_error || ERROR_RE.test(head)) && !seenTools.has(lastTool)) {
        seenTools.add(lastTool);
        push('tool_error', `[도구 ${lastTool}] ${clip(head, 300)}`, { ts: t.ts, tool: lastTool, suggested_category: '도구 실패' });
      }
    }
  }
  const ngrams = new Set();
  for (let i = 0; i + 3 <= seq.length; i++) {
    const g = seq.slice(i, i + 3);
    if (new Set(g).size > 1) ngrams.add(g.join('>'));
  }
  return { candidates: cands, ngrams: [...ngrams] };
}

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && e.name.endsWith('.jsonl')) yield p;
  }
}

export async function mine(base, cfg, { days = cfg.mine_days || 30, log = () => {} } = {}) {
  const state = loadState(base);
  const queue = loadQueue(base);
  const known = new Set([...queue.map((c) => c.id), ...state.dismissed]);
  const cutoff = Date.now() - days * 86400000;
  const summary = { files_scanned: 0, files_skipped: 0, sessions: 0, candidates_added: 0, loops_added: 0 };
  const parsers = { claude: parseClaude, codex: parseCodex };
  for (const [agent, acfg] of Object.entries(cfg.agents || {})) {
    const dir = acfg?.transcripts;
    if (!dir || !fs.existsSync(dir)) continue;
    for (const file of walk(dir)) {
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      if (st.mtimeMs < cutoff) continue;
      const prev = state.files[file];
      if (prev && prev.size === st.size && prev.mtime === st.mtimeMs) { summary.files_skipped++; continue; }
      summary.files_scanned++;
      let session;
      try { session = await parsers[agent](file); } catch (e) { log(`parse failed: ${file}: ${e.message}`); continue; }
      if (!session.session_id) continue;
      summary.sessions++;
      state.files[file] = { size: st.size, mtime: st.mtimeMs };
      state.sessions[`${agent}:${session.session_id}`] = { agent, cwd: session.cwd, start: session.start, end: session.end, file };
      const { candidates, ngrams } = extract(session);
      for (const c of candidates) {
        if (known.has(c.id)) continue;
        known.add(c.id);
        queue.push({ ...c, status: 'pending', found: new Date().toISOString() });
        summary.candidates_added++;
      }
      for (const g of ngrams) {
        const key = `${session.cwd}||${g}`;
        const arr = state.ngrams[key] || (state.ngrams[key] = []);
        if (!arr.includes(session.session_id)) arr.push(session.session_id);
      }
    }
  }
  // Tool-name loops are weak evidence on their own (Read→Write→Bash is just work), so they need
  // 5+ sessions in the same folder and never crowd out corrections/errors in the queue.
  for (const [key, sessions] of Object.entries(state.ngrams)) {
    if (sessions.length < LOOP_MIN_SESSIONS) continue;
    const [cwd, g] = key.split('||');
    const id = 'C-' + crypto.createHash('sha1').update('loop|' + key).digest('hex').slice(0, 8);
    if (known.has(id)) continue;
    known.add(id);
    queue.push({ id, kind: 'loop', agent: 'both', session: sessions[sessions.length - 1], cwd, ts: null, status: 'pending', found: new Date().toISOString(),
      suggested_category: '반복 비효율', excerpt: `도구 호출 순서 "${g.replace(/>/g, ' → ')}"가 ${sessions.length}개 세션에서 반복됨 (폴더 ${cwd}) — 스크립트·스킬 후보` });
    summary.loops_added++;
  }
  const pending = queue.filter((c) => c.status === 'pending');
  const newest = (a, b) => String(b.ts || b.found).localeCompare(String(a.ts || a.found));
  const loops = pending.filter((c) => c.kind === 'loop').sort(newest).slice(0, QUEUE_MAX_LOOPS);
  const others = pending.filter((c) => c.kind !== 'loop').sort(newest).slice(0, QUEUE_MAX - loops.length);
  const trimmed = [...others, ...loops];
  state.last_run = new Date().toISOString();
  saveQueue(base, trimmed);
  writeJson(stateFile(base), state);
  summary.queue_size = trimmed.length;
  return summary;
}

// Attach agent+session to records that have a timestamp but no session, by cwd + time window.
export function linkSessions(base, aliases = {}) {
  const state = loadState(base);
  const sessions = Object.entries(state.sessions);
  let linked = 0;
  for (const r of listRecords(base)) {
    if (r.session || !r.ts || !r.project) continue;
    const proj = normalizePath(r.project, aliases);
    const t = Date.parse(r.ts);
    if (!t) continue;
    const hit = sessions.find(([, s]) => s.cwd && normalizePath(s.cwd, aliases) === proj
      && Date.parse(s.start) - 300000 <= t && t <= Date.parse(s.end) + 300000);
    if (hit) { updateRecord(base, r.id, { session: hit[0], agent: hit[1].agent }); linked++; }
  }
  return linked;
}

export function takeCandidate(base, id) {
  const q = loadQueue(base);
  const i = q.findIndex((c) => c.id === id);
  if (i < 0) return null;
  const [c] = q.splice(i, 1);
  saveQueue(base, q);
  return c;
}

export function dismissCandidate(base, id) {
  const c = takeCandidate(base, id);
  const state = loadState(base);
  if (!state.dismissed.includes(id)) state.dismissed.push(id);
  writeJson(stateFile(base), state);
  return !!c;
}

export function pickCandidates(base, { project = '', limit = 3, aliases = {} } = {}) {
  const q = loadQueue(base).filter((c) => c.status === 'pending');
  const proj = project ? normalizePath(project, aliases) : '';
  const score = (c) => (proj && c.cwd && normalizePath(c.cwd, aliases) === proj ? 2 : 0) + (c.kind === 'loop' ? -1 : 0);
  return q.sort((a, b) => score(b) - score(a) || String(b.found).localeCompare(String(a.found))).slice(0, limit);
}
