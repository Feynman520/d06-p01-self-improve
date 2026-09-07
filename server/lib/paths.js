import fs from 'node:fs';
import path from 'node:path';

const isWin = process.platform === 'win32';
const norm = (p) => String(p || '').replace(/[\\/]+/g, path.sep).replace(new RegExp(`\\${path.sep}+$`), '');
const eq = (a, b) => (isWin ? a.toLowerCase() === b.toLowerCase() : a === b);
const startsWith = (a, b) => (isWin ? a.toLowerCase().startsWith(b.toLowerCase()) : a.startsWith(b));

// Apply configured prefix aliases (e.g. a workspace that moved) and normalise separators.
export function normalizePath(p, aliases = {}) {
  let out = norm(p);
  if (!out) return '';
  for (const [from, to] of Object.entries(aliases)) {
    const f = norm(from);
    if (eq(out, f) || startsWith(out, f + path.sep)) { out = norm(to) + out.slice(f.length); break; }
  }
  return out;
}

export function commonAncestor(paths) {
  const lists = paths.filter(Boolean).map((p) => norm(p).split(path.sep));
  if (!lists.length) return null;
  const first = lists[0];
  let n = first.length;
  for (const l of lists.slice(1)) {
    let i = 0;
    while (i < n && i < l.length && eq(first[i], l[i])) i++;
    n = i;
  }
  if (n === 0) return null;
  const joined = first.slice(0, n).join(path.sep);
  return /^[a-z]:$/i.test(joined) ? joined + path.sep : joined;
}

export function instructionFile(dir) {
  for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    const f = path.join(dir, name);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

// Create the instruction file pair when a folder has none:
// AGENTS.md holds content (agent-neutral), CLAUDE.md is the one-line '@AGENTS.md' shell.
export function ensureInstructionFile(dir) {
  const existing = instructionFile(dir);
  if (existing) return existing;
  fs.mkdirSync(dir, { recursive: true });
  const agents = path.join(dir, 'AGENTS.md');
  fs.writeFileSync(agents, `# ${path.basename(dir)}\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '@AGENTS.md\n', 'utf8');
  return agents;
}

// Narrowest folder that (a) contains every project the records came from,
// (b) already has an instruction file, and (c) is not above the configured root.
export function pickLevel(projectPaths, { root = '', aliases = {} } = {}) {
  const r = root ? normalizePath(root, aliases) : '';
  const paths = projectPaths.map((p) => normalizePath(p, aliases)).filter((p) => p && fs.existsSync(p));
  let dir = commonAncestor(paths);
  if (!dir) return r || null;
  if (r && !(eq(dir, r) || startsWith(dir, r + path.sep))) return r;
  for (;;) {
    if (instructionFile(dir)) return dir;
    if (r && eq(dir, r)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return r || dir;
    dir = parent;
  }
}
