import path from 'node:path';
import { readJson, writeJson, withLock } from './store.js';
import { isSameLesson } from './similar.js';

export const ARTIFACT_TYPES = ['rule', 'skill', 'script'];
export const TRUST = { promote_success: 3, retire_corrections: 2 };
const file = (base) => path.join(base, 'registry.json');
const empty = () => ({ next_rule: 1, next_artifact: 1, artifacts: [] });

export function loadRegistry(base) { return readJson(file(base), empty()); }
function save(base, reg) { writeJson(file(base), reg); }
const pad = (n) => String(n).padStart(3, '0');
const now = () => new Date().toISOString();

export function addArtifact(base, a) {
  return withLock(base, 'registry', () => {
    const reg = loadRegistry(base);
    const id = `A-${pad(reg.next_artifact++)}`;
    const rule_id = a.type === 'rule' ? `R-${pad(reg.next_rule++)}` : undefined;
    const art = {
      id, rule_id, type: a.type, name: a.name || rule_id, path: a.path, level: a.level || '', text: a.text || '',
      records: a.records || [], version: 1, trust: { success: 0, corrections: 0 }, status: 'active',
      created: now(), updated: now(), history: [{ ts: now(), event: 'created', note: a.note || '' }],
    };
    reg.artifacts.push(art);
    save(base, reg);
    return art;
  });
}

export function getArtifact(base, id) {
  return loadRegistry(base).artifacts.find((a) => a.id === id || a.rule_id === id || a.name === id) || null;
}

export function updateArtifact(base, id, mutate) {
  return withLock(base, 'registry', () => {
    const reg = loadRegistry(base);
    const art = reg.artifacts.find((a) => a.id === id || a.rule_id === id || a.name === id);
    if (!art) return null;
    mutate(art);
    art.updated = now();
    save(base, reg);
    return art;
  });
}

export function activeArtifacts(base) {
  return loadRegistry(base).artifacts.filter((a) => a.status === 'active');
}

// An active artifact that already covers this lesson — by shared record id or by lesson text.
export function findCoveringArtifact(base, { record_ids = [], lesson = '' }) {
  return activeArtifacts(base).find((a) =>
    a.records.some((id) => record_ids.includes(id)) || (lesson && a.text && isSameLesson(lesson, a.text))) || null;
}

export function recordFeedback(base, id, outcome, note = '') {
  const art = updateArtifact(base, id, (a) => {
    if (outcome === 'success') a.trust.success++;
    else if (outcome === 'correction') { a.trust.corrections++; a.version++; }
    a.history.push({ ts: now(), event: outcome, note });
  });
  if (!art) return null;
  const promoted = art.trust.success >= TRUST.promote_success && art.trust.corrections === 0;
  const retire = art.trust.corrections >= TRUST.retire_corrections && art.trust.success === 0;
  return { artifact: art, promoted, retire };
}

export function retireArtifact(base, id, note = '') {
  return updateArtifact(base, id, (a) => { a.status = 'retired'; a.history.push({ ts: now(), event: 'retired', note }); });
}
