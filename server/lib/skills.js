import fs from 'node:fs';
import path from 'node:path';
import { skillsDir, scriptsDir } from './store.js';

export const SKILL_PREFIX = 'si-';

// Copy the central skill folder into every agent's skills directory whose parent exists.
export function syncSkill(base, name, agents) {
  const src = path.join(skillsDir(base), name);
  if (!fs.existsSync(path.join(src, 'SKILL.md'))) throw new Error(`SKILL.md not found: ${src}`);
  const synced = [];
  for (const [agent, cfg] of Object.entries(agents || {})) {
    if (!cfg?.skills || !fs.existsSync(path.dirname(cfg.skills))) continue;
    const dst = path.join(cfg.skills, SKILL_PREFIX + name);
    fs.rmSync(dst, { recursive: true, force: true });
    fs.cpSync(src, dst, { recursive: true });
    synced.push({ agent, path: dst });
  }
  return synced;
}

export function unsyncSkill(base, name, agents) {
  const removed = [];
  for (const [agent, cfg] of Object.entries(agents || {})) {
    const dst = cfg?.skills && path.join(cfg.skills, SKILL_PREFIX + name);
    if (dst && fs.existsSync(dst)) { fs.rmSync(dst, { recursive: true, force: true }); removed.push({ agent, path: dst }); }
  }
  const src = path.join(skillsDir(base), name);
  if (fs.existsSync(src)) {
    const retired = path.join(skillsDir(base), '_retired');
    fs.mkdirSync(retired, { recursive: true });
    fs.renameSync(src, path.join(retired, `${name}-${Date.now()}`));
  }
  return removed;
}

// Scripts live centrally; trust is a marker file the guard checks at run time.
export const scriptPath = (base, name) => path.join(scriptsDir(base), name);
export const trustedMarker = (base, name) => path.join(scriptsDir(base), `${name}.trusted`);
export function markTrusted(base, name) { fs.writeFileSync(trustedMarker(base, name), new Date().toISOString() + '\n', 'utf8'); }
export function retireScript(base, name) {
  const src = scriptPath(base, name);
  if (!fs.existsSync(src)) return false;
  const retired = path.join(scriptsDir(base), '_retired');
  fs.mkdirSync(retired, { recursive: true });
  fs.renameSync(src, path.join(retired, `${Date.now()}-${name}`));
  fs.rmSync(trustedMarker(base, name), { force: true });
  return true;
}
export function scriptUsesGuard(base, name) {
  const src = scriptPath(base, name);
  if (!fs.existsSync(src)) return false;
  return /_guard\.(mjs|py)/.test(fs.readFileSync(src, 'utf8'));
}

// Install the guard helpers next to generated scripts.
export function installGuards(base, assetsDir) {
  fs.mkdirSync(scriptsDir(base), { recursive: true });
  const out = [];
  for (const f of ['_guard.mjs', '_guard.py']) {
    const dst = path.join(scriptsDir(base), f);
    fs.copyFileSync(path.join(assetsDir, f), dst);
    out.push(dst);
  }
  return out;
}
