import fs from 'node:fs';
import path from 'node:path';

const SECTION_KEYS = [
  ['happened', '무슨 일이 있었나'],
  ['wanted', '사용자가 진짜 원한 것'],
  ['lesson', '교훈'],
  ['candidates', '해결책 후보'],
];
const FM_KEYS = ['id', 'date', 'project', 'category', 'status', 'related', 'resolution'];

export function baseDir(env = process.env, cwd = process.cwd()) {
  const v = env.SELF_IMPROVE_DIR && env.SELF_IMPROVE_DIR.trim();
  return v || path.join(cwd, '.self-improve');
}
export const recordsDir = (base) => path.join(base, 'records');
export const reportsDir = (base) => path.join(base, 'reports');
export function ensureDirs(base) {
  fs.mkdirSync(recordsDir(base), { recursive: true });
  fs.mkdirSync(reportsDir(base), { recursive: true });
}

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
  for (const [key, title] of SECTION_KEYS) {
    const sm = m[2].match(new RegExp(`## ${title}\\r?\\n([\\s\\S]*?)(?=\\r?\\n## |$)`));
    rec.sections[key] = sm ? sm[1].trim() : '';
  }
  return rec;
}

const fileOf = (base, id) => path.join(recordsDir(base), `${id}.md`);

export function saveRecord(base, record) {
  ensureDirs(base);
  const file = fileOf(base, record.id);
  fs.writeFileSync(file, serializeRecord(record), 'utf8');
  return file;
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
  const file = fileOf(base, id);
  if (!fs.existsSync(file)) return false;
  const rec = parseRecord(fs.readFileSync(file, 'utf8'));
  if (!rec) return false;
  Object.assign(rec, patch);
  fs.writeFileSync(file, serializeRecord(rec), 'utf8');
  return true;
}

export function deleteRecord(base, id) {
  const file = fileOf(base, id);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}
