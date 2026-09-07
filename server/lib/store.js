import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SECTION_KEYS = [
  ['happened', '무슨 일이 있었나'],
  ['wanted', '사용자가 진짜 원한 것'],
  ['lesson', '교훈'],
  ['candidates', '해결책 후보'],
];
const FM_KEYS = ['id', 'date', 'ts', 'project', 'agent', 'session', 'source', 'category', 'status', 'related', 'artifact', 'resolution'];
export const STATUSES = ['open', 'resolved', 'rejected'];

export function baseDir(env = process.env, cwd = process.cwd()) {
  const v = env.SELF_IMPROVE_DIR && env.SELF_IMPROVE_DIR.trim();
  return v || path.join(cwd, '.self-improve');
}
export const recordsDir = (base) => path.join(base, 'records');
export const skillsDir = (base) => path.join(base, 'skills');
export const scriptsDir = (base) => path.join(base, 'scripts');
export const queueDir = (base) => path.join(base, 'queue');
export const locksDir = (base) => path.join(base, 'locks');

export function ensureDirs(base) {
  for (const d of [recordsDir(base), skillsDir(base), scriptsDir(base), queueDir(base), locksDir(base)]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

// ---- config ---------------------------------------------------------------
const home = () => os.homedir();
export function defaultConfig(env = process.env) {
  const claudeHome = env.CLAUDE_CONFIG_DIR || path.join(home(), '.claude');
  const codexHome = env.CODEX_HOME || path.join(home(), '.codex');
  return {
    root: env.SELF_IMPROVE_ROOT || '',
    path_aliases: {},
    rule_cap: 30,
    ripe_threshold: { default: 2, '오해': 3 },
    mine_days: 30,
    candidates_per_session: 3,
    retire_after_days: 60,
    agents: {
      claude: { skills: path.join(claudeHome, 'skills'), transcripts: path.join(claudeHome, 'projects') },
      codex: { skills: path.join(codexHome, 'skills'), transcripts: path.join(codexHome, 'sessions') },
    },
  };
}
export function loadConfig(base, env = process.env) {
  const def = defaultConfig(env);
  const file = path.join(base, 'config.json');
  if (!fs.existsSync(file)) return def;
  try {
    const user = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      ...def, ...user,
      ripe_threshold: { ...def.ripe_threshold, ...(user.ripe_threshold || {}) },
      agents: {
        claude: { ...def.agents.claude, ...((user.agents || {}).claude || {}) },
        codex: { ...def.agents.codex, ...((user.agents || {}).codex || {}) },
      },
    };
  } catch (e) {
    return { ...def, config_error: `${file}: ${e.message}` };
  }
}
export function saveConfig(base, cfg) {
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(path.join(base, 'config.json'), JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

// ---- locks (mkdir is atomic on every platform) -----------------------------
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
export function withLock(base, name, fn, { timeoutMs = 5000, staleMs = 30000 } = {}) {
  fs.mkdirSync(locksDir(base), { recursive: true });
  const dir = path.join(locksDir(base), `${name}.lock`);
  const started = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(dir);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - fs.statSync(dir).mtimeMs > staleMs) { fs.rmSync(dir, { recursive: true, force: true }); continue; }
      } catch { /* lock vanished */ }
      if (Date.now() - started > timeoutMs) throw new Error(`lock timeout: ${name}`);
      sleepSync(50);
    }
  }
  try { return fn(); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// ---- records ---------------------------------------------------------------
export function nextId(base, date) {
  const dir = recordsDir(base);
  let max = 0;
  if (fs.existsSync(dir)) {
    const re = new RegExp(`^${date}-(\\d{3})\\.md$`);
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(re);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  }
  return `${date}-${String(max + 1).padStart(3, '0')}`;
}

export function serializeRecord(r) {
  const fm = FM_KEYS.map((k) => `${k}: ${r[k] ?? ''}`).join('\n');
  const body = SECTION_KEYS
    .map(([key, title]) => `## ${title}\n\n${String(r.sections?.[key] ?? '').trim()}`)
    .join('\n\n');
  return `---\n${fm}\n---\n\n${body}\n`;
}

export function parseRecord(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const rec = { sections: {} };
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) rec[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (!rec.status) rec.status = 'open';
  for (const [key, title] of SECTION_KEYS) {
    const sm = m[2].match(new RegExp(`## ${title}\\r?\\n([\\s\\S]*?)(?=\\r?\\n## |$)`));
    rec.sections[key] = sm ? sm[1].trim() : '';
  }
  return rec;
}

const fileOf = (base, id) => path.join(recordsDir(base), `${id}.md`);

// Atomic create: claims the next id with an exclusive 'wx' write, retrying on collision
// (several agent sessions may log at the same moment).
export function createRecord(base, record, date) {
  ensureDirs(base);
  for (let attempt = 0; attempt < 100; attempt++) {
    const id = nextId(base, date);
    const file = fileOf(base, id);
    try {
      fs.writeFileSync(file, serializeRecord({ ...record, id }), { encoding: 'utf8', flag: 'wx' });
      return { id, file };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
  throw new Error('could not allocate a record id');
}

export function saveRecord(base, record) {
  ensureDirs(base);
  const file = fileOf(base, record.id);
  fs.writeFileSync(file, serializeRecord(record), 'utf8');
  return file;
}

export function getRecord(base, id) {
  const file = fileOf(base, id);
  if (!fs.existsSync(file)) return null;
  return parseRecord(fs.readFileSync(file, 'utf8'));
}

export function listRecords(base) {
  const dir = recordsDir(base);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => parseRecord(fs.readFileSync(path.join(dir, f), 'utf8')))
    .filter(Boolean)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export function updateRecord(base, id, patch) {
  const rec = getRecord(base, id);
  if (!rec) return false;
  Object.assign(rec, patch);
  fs.writeFileSync(fileOf(base, id), serializeRecord(rec), 'utf8');
  return true;
}

export function deleteRecord(base, id) {
  const file = fileOf(base, id);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

// ---- small JSON files -------------------------------------------------------
export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}
