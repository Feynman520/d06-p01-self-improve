import fs from 'node:fs';

export const BEGIN = '<!-- self-improve:begin';
export const END = '<!-- self-improve:end -->';
const BEGIN_LINE = `${BEGIN} — 자기개선 플러그인이 자동으로 관리하는 구역입니다. 손으로 고치지 마세요. 규칙을 빼려면 에이전트에게 "규칙 R-001 빼"라고 말하세요. -->`;
const HEADER = '## 자기개선 규칙 (자동 적용)';
const RULE_RE = /^- \[(R-\d{3,})\] (.*?)(?: \(근거 기록: ([^)]*)\))?\s*$/;

function readText(file) {
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8');
}
const eolOf = (text) => (/\r\n/.test(text) ? '\r\n' : '\n');

export function splitBlock(text) {
  const b = text.indexOf(BEGIN);
  if (b < 0) return null;
  const e = text.indexOf(END, b);
  if (e < 0) return null;
  const endIdx = e + END.length;
  return { before: text.slice(0, b), block: text.slice(b, endIdx), after: text.slice(endIdx) };
}

export function parseBlock(block) {
  const lines = block.split(/\r?\n/);
  const rules = [];
  const instr = [];
  let inInstr = false;
  for (const line of lines) {
    const m = line.match(RULE_RE);
    if (m) { rules.push({ id: m[1], text: m[2], records: m[3] ? m[3].split(',').map((s) => s.trim()).filter(Boolean) : [] }); inInstr = false; continue; }
    if (line.startsWith('### ')) { inInstr = true; instr.push(line); continue; }
    if (line.startsWith(HEADER) || line.startsWith(BEGIN) || line.startsWith(END)) { inInstr = false; continue; }
    if (inInstr) instr.push(line);
  }
  return { rules, instructions: instr.join('\n').trim() };
}

export function renderBlock({ rules = [], instructions = '' }, eol = '\n') {
  const out = [BEGIN_LINE];
  if (instructions) out.push(instructions.trim().replace(/\r?\n/g, eol), '');
  out.push(HEADER, '');
  if (!rules.length) out.push('(아직 자동 적용된 규칙이 없습니다)');
  for (const r of rules) out.push(`- [${r.id}] ${r.text}${r.records?.length ? ` (근거 기록: ${r.records.join(', ')})` : ''}`);
  out.push(END);
  return out.join(eol);
}

export function readRules(file) {
  const parts = splitBlock(readText(file));
  return parts ? parseBlock(parts.block) : { rules: [], instructions: '' };
}

function writeBlock(file, mutate) {
  const text = readText(file);
  const eol = eolOf(text);
  const parts = splitBlock(text);
  const current = parts ? parseBlock(parts.block) : { rules: [], instructions: '' };
  const next = mutate(current) || current;
  const rendered = renderBlock(next, eol);
  let out;
  if (parts) out = parts.before + rendered + parts.after;
  else out = (text.endsWith(eol) || !text ? text : text + eol) + (text ? eol : '') + rendered + eol;
  fs.writeFileSync(file, out, 'utf8');
  return next;
}

export function ensureBlock(file, { instructions } = {}) {
  return writeBlock(file, (cur) => ({ ...cur, instructions: instructions ?? cur.instructions }));
}

export function upsertRule(file, rule, { cap = 30 } = {}) {
  return writeBlock(file, (cur) => {
    const rules = cur.rules.filter((r) => r.id !== rule.id);
    rules.push({ id: rule.id, text: rule.text, records: rule.records || [] });
    if (rules.length > cap) {
      const err = new Error(`rule cap (${cap}) reached in ${file} — consolidate or revoke rules first`);
      err.code = 'RULE_CAP';
      throw err;
    }
    return { ...cur, rules };
  });
}

export function removeRule(file, ruleId) {
  let removed = false;
  writeBlock(file, (cur) => {
    const rules = cur.rules.filter((r) => (r.id === ruleId ? ((removed = true), false) : true));
    return { ...cur, rules };
  });
  return removed;
}

export function hasRule(file, ruleId) {
  return readRules(file).rules.some((r) => r.id === ruleId);
}
