import fs from 'node:fs';
import path from 'node:path';
import { ensureDirs, createRecord, listRecords, getRecord, updateRecord, loadConfig, withLock, STATUSES } from './store.js';
import { findRelated, findCluster, clusterRecords } from './similar.js';
import { normalizePath, pickLevel, ensureInstructionFile } from './paths.js';
import { upsertRule, removeRule, hasRule, ensureBlock } from './managed.js';
import { addArtifact, getArtifact, activeArtifacts, findCoveringArtifact, recordFeedback, retireArtifact, loadRegistry } from './registry.js';
import { syncSkill, unsyncSkill, retireScript, scriptUsesGuard, scriptPath, markTrusted } from './skills.js';
import { takeCandidate, dismissCandidate, pickCandidates, loadQueue } from './mine.js';
import { INSTRUCTIONS } from './instructions.js';

export const CATEGORIES = ['오해', '지식 부족', '도구 실패', '환경 문제', '반복 비효율'];
export const PRESCRIPTIONS = ['claude_md', 'skill', 'script', 'library', 'mcp', 'other'];

const isWin = process.platform === 'win32';
const sameDir = (a, b) => (isWin ? a.toLowerCase() === b.toLowerCase() : a === b);
const thresholdFor = (cfg, category) => cfg.ripe_threshold?.[category] ?? cfg.ripe_threshold?.default ?? 2;
const lessonOf = (r) => r.sections?.lesson || '';
const brief = (a) => a && ({ id: a.id, rule_id: a.rule_id, type: a.type, name: a.name, path: a.path, text: a.text, records: a.records, trust: a.trust, version: a.version });
const summarize = (r) => ({
  id: r.id, date: r.date, category: r.category, status: r.status, project: r.project, agent: r.agent || '', session: r.session || '',
  lesson: lessonOf(r), related: r.related || '', artifact: r.artifact || '', resolution: r.resolution || '',
});

function validateLesson(lesson) {
  const t = String(lesson || '').trim();
  if (t.length < 10) throw new Error('lesson is required — one generalized sentence (>= 10 chars) reusable next time');
  if (t.length > 600) throw new Error('lesson too long — state the reusable lesson in ONE sentence (<= 600 chars)');
  return t;
}

function levelFor(base, cfg, ids) {
  const projects = ids.map((id) => getRecord(base, id)?.project).filter(Boolean);
  return pickLevel(projects, { root: cfg.root, aliases: cfg.path_aliases });
}

export function logRecord(base, input, today = new Date().toISOString().slice(0, 10), nowIso = new Date().toISOString()) {
  if (!CATEGORIES.includes(input.category)) throw new Error(`category must be one of: ${CATEGORIES.join(', ')}`);
  const lesson = validateLesson(input.lesson);
  ensureDirs(base);
  const cfg = loadConfig(base);
  const all = listRecords(base);
  const open = all.filter((r) => r.status === 'open');
  const resolved = all.filter((r) => r.status === 'resolved');
  const related = findRelated(all, { lesson, category: input.category });
  const cluster = findCluster(open, { lesson, category: input.category });
  const resolvedHits = findCluster(resolved, { lesson, category: input.category });
  const candidate = input.candidate_id ? takeCandidate(base, input.candidate_id) : null;
  const { id, file } = createRecord(base, {
    date: today, ts: nowIso, project: input.project || candidate?.cwd || '', agent: input.agent || candidate?.agent || '',
    session: input.session || (candidate?.session ? `${candidate.agent}:${candidate.session}` : ''),
    source: candidate ? 'mined' : 'model', category: input.category, status: 'open', related: related.join(', '), artifact: '', resolution: '',
    sections: { happened: input.what_happened || '', wanted: input.user_wanted || '', lesson, candidates: input.solution_candidates || '' },
  }, today);
  const threshold = thresholdFor(cfg, input.category);
  let ripe = null;
  if (cluster.length + 1 >= threshold) {
    const ids = [...cluster, id];
    const existing = findCoveringArtifact(base, { record_ids: cluster, lesson });
    ripe = {
      ids, count: ids.length, threshold,
      suggested_level: levelFor(base, cfg, ids),
      existing_artifact: brief(existing),
      next_action: existing ? 'fix_artifact_then_feedback_correction' : 'confirm_same_lesson_then_apply_rule',
    };
  }
  const recurrence_of_resolved = resolvedHits.map((rid) => {
    const r = getRecord(base, rid);
    return { id: rid, artifact: brief(r?.artifact ? getArtifact(base, r.artifact) : null), resolution: r?.resolution || '' };
  });
  return {
    id, file, related, ripe, recurrence_of_resolved,
    next_action: ripe ? ripe.next_action : recurrence_of_resolved.length ? 'escalate_prescription (rule → skill → script)' : 'none',
  };
}

export function searchRecords(base, q = {}) {
  const kw = (q.keyword || '').toLowerCase();
  return listRecords(base)
    .filter((r) =>
      (!q.category || r.category === q.category) &&
      (!q.status || r.status === q.status) &&
      (!q.project || (r.project || '').toLowerCase().includes(q.project.toLowerCase())) &&
      (!kw || [r.sections?.happened, r.sections?.wanted, r.sections?.lesson, r.sections?.candidates, r.project].join(' ').toLowerCase().includes(kw)))
    .map(summarize);
}

export function ripeClusters(base, cfg = loadConfig(base)) {
  const open = listRecords(base).filter((r) => r.status === 'open');
  return clusterRecords(open)
    .filter((c) => c.ids.length >= thresholdFor(cfg, c.category))
    .map((c) => ({ ...c, existing_artifact: brief(findCoveringArtifact(base, { record_ids: c.ids, lesson: c.seed })), suggested_level: levelFor(base, cfg, c.ids) }))
    .sort((a, b) => b.ids.length - a.ids.length);
}

export function statsRecords(base) {
  const cfg = loadConfig(base);
  const all = listRecords(base);
  const by = (f) => all.reduce((m, r) => { const k = f(r) || '(없음)'; m[k] = (m[k] || 0) + 1; return m; }, {});
  const open = all.filter((r) => r.status === 'open');
  const clusters = clusterRecords(open).filter((c) => c.ids.length >= 2);
  const clustered = clusters.reduce((n, c) => n + c.ids.length, 0);
  const reg = loadRegistry(base);
  const count = (pred) => reg.artifacts.filter(pred).length;
  return {
    storage_dir: base,
    config_error: cfg.config_error || null,
    total: all.length,
    open: open.length,
    resolved: all.filter((r) => r.status === 'resolved').length,
    rejected: all.filter((r) => r.status === 'rejected').length,
    by_category: by((r) => r.category),
    by_month: by((r) => (r.date || '').slice(0, 7)),
    by_project: by((r) => r.project),
    recurrence: {
      open_records_in_repeat_clusters: clustered,
      repeat_clusters: clusters.length,
      ripe_clusters: ripeClusters(base, cfg).length,
      recurrence_rate: all.length ? Math.round((clustered / all.length) * 1000) / 10 : 0,
    },
    artifacts: {
      active_rules: count((a) => a.status === 'active' && a.type === 'rule'),
      active_skills: count((a) => a.status === 'active' && a.type === 'skill'),
      active_scripts: count((a) => a.status === 'active' && a.type === 'script'),
      retired: count((a) => a.status === 'retired'),
    },
    pending_candidates: loadQueue(base).length,
    last_record_date: all.map((r) => r.date).sort().pop() || null,
  };
}

export function resolveRecords(base, { ids = [], resolution = '', artifact_id = '' }) {
  let art = null;
  if (artifact_id) {
    art = getArtifact(base, artifact_id);
    if (!art) throw new Error(`artifact not found: ${artifact_id}`);
    if (art.type === 'rule' && !hasRule(art.path, art.rule_id)) throw new Error(`rule ${art.rule_id} is not present in ${art.path} — apply it first (apply_rule)`);
  }
  const resolved = []; const not_found = [];
  for (const id of ids) {
    (updateRecord(base, id, { status: 'resolved', resolution, artifact: art?.id || '' }) ? resolved : not_found).push(id);
  }
  return { resolved, not_found };
}

export function applyRule(base, { record_ids = [], rule_text = '', level = '' }) {
  const text = String(rule_text || '').trim();
  if (text.length < 10 || text.length > 300) throw new Error('rule_text must be one clear sentence (10–300 chars)');
  const ids = record_ids.filter((id) => getRecord(base, id));
  if (!ids.length) throw new Error('record_ids must contain at least one existing record');
  const cfg = loadConfig(base);
  const existing = findCoveringArtifact(base, { record_ids: ids, lesson: text });
  if (existing) throw new Error(`already covered by ${existing.id} (${existing.rule_id || existing.name}) — fix that artifact instead, then call feedback(correction)`);
  const lvl = level ? normalizePath(level, cfg.path_aliases) : levelFor(base, cfg, ids);
  if (!lvl) throw new Error('could not determine the folder level — pass `level` (an existing folder path) or set `root` in config.json');
  if (!fs.existsSync(lvl)) throw new Error(`level folder does not exist: ${lvl}`);
  const file = ensureInstructionFile(lvl);
  const art = addArtifact(base, { type: 'rule', path: file, level: lvl, text, records: ids, note: 'auto-applied on recurrence' });
  try {
    withLock(base, 'managed', () => {
      if (cfg.root && sameDir(normalizePath(cfg.root, cfg.path_aliases), lvl)) ensureBlock(file, { instructions: INSTRUCTIONS });
      upsertRule(file, { id: art.rule_id, text, records: ids }, { cap: cfg.rule_cap });
    });
  } catch (e) {
    retireArtifact(base, art.id, `apply failed: ${e.message}`);
    throw e;
  }
  for (const id of ids) updateRecord(base, id, { status: 'resolved', artifact: art.id, resolution: `[${art.rule_id}] 규칙 자동 적용 → ${file}` });
  return { artifact_id: art.id, rule_id: art.rule_id, file, level: lvl, rule_text: text, records: ids,
    notice: `📌 규칙 자동 적용: [${art.rule_id}] ${text} (되돌리기: "규칙 ${art.rule_id} 빼")` };
}

export function registerArtifact(base, { type, name, record_ids = [], description = '' }) {
  if (!['skill', 'script'].includes(type)) throw new Error('type must be skill or script');
  if (!name || /[\\/]/.test(name)) throw new Error('name must be a plain folder/file name');
  const ids = record_ids.filter((id) => getRecord(base, id));
  const cfg = loadConfig(base);
  let p; let synced = [];
  if (type === 'skill') {
    synced = syncSkill(base, name, cfg.agents);
    p = path.join(base, 'skills', name);
  } else {
    p = scriptPath(base, name);
    if (!fs.existsSync(p)) throw new Error(`script not found: ${p}`);
    if (!scriptUsesGuard(base, name)) throw new Error(`script must use the guard (_guard.mjs / _guard.py) so it stays in preview mode until trusted: ${p}`);
  }
  const art = addArtifact(base, { type, name, path: p, text: description, records: ids, note: 'registered' });
  for (const id of ids) updateRecord(base, id, { status: 'resolved', artifact: art.id, resolution: `[${type}] ${name} 자동 생성 → ${p}` });
  return { artifact_id: art.id, type, name, path: p, synced, records: ids, notice: `🔧 자동 ${type === 'skill' ? '스킬' : '스크립트'} ${name} 등록 (되돌리기: "${name} 빼")` };
}

function removeArtifactFiles(base, cfg, art) {
  if (art.type === 'rule') return withLock(base, 'managed', () => removeRule(art.path, art.rule_id));
  if (art.type === 'skill') return unsyncSkill(base, art.name, cfg.agents);
  if (art.type === 'script') return retireScript(base, art.name);
  return false;
}

export function revokeArtifact(base, { id = '', query = '' }) {
  const cfg = loadConfig(base);
  let art = id ? getArtifact(base, id) : null;
  if (!art && query) {
    const q = query.toLowerCase();
    art = activeArtifacts(base).find((a) => (a.text || '').toLowerCase().includes(q) || (a.name || '').toLowerCase().includes(q)) || null;
  }
  if (!art) throw new Error(`artifact not found: ${id || query}`);
  if (art.status !== 'active') return { artifact_id: art.id, already: art.status };
  const removed = removeArtifactFiles(base, cfg, art);
  retireArtifact(base, art.id, 'revoked by user');
  for (const rid of art.records) updateRecord(base, rid, { status: 'rejected', resolution: `revoked ${art.id}` });
  return { artifact_id: art.id, rule_id: art.rule_id, type: art.type, name: art.name, removed, records_rejected: art.records };
}

export function feedbackArtifact(base, { artifact_id, outcome, note = '' }) {
  if (!['success', 'correction'].includes(outcome)) throw new Error('outcome must be success or correction');
  const r = recordFeedback(base, artifact_id, outcome, note);
  if (!r) throw new Error(`artifact not found: ${artifact_id}`);
  const cfg = loadConfig(base);
  const out = { artifact_id: r.artifact.id, type: r.artifact.type, trust: r.artifact.trust, version: r.artifact.version, promoted: false, retired: false };
  if (r.promoted && r.artifact.type === 'script' && r.artifact.status === 'active') { markTrusted(base, r.artifact.name); out.promoted = true; }
  if (r.retire && r.artifact.status === 'active') {
    removeArtifactFiles(base, cfg, r.artifact);
    retireArtifact(base, r.artifact.id, 'retired: corrections without any success');
    for (const rid of r.artifact.records) updateRecord(base, rid, { status: 'open', artifact: '', resolution: `retired ${r.artifact.id}` });
    out.retired = true;
  }
  return out;
}

export function pendingWork(base, { project = '' } = {}) {
  const cfg = loadConfig(base);
  const all = listRecords(base);
  const resolved = all.filter((r) => r.status === 'resolved');
  const escalations = all.filter((r) => r.status === 'open').flatMap((r) => {
    const hits = findCluster(resolved, { lesson: lessonOf(r), category: r.category });
    return hits.length ? [{ id: r.id, lesson: lessonOf(r), recurred_after: hits.map((h) => ({ id: h, artifact: getRecord(base, h)?.artifact || '' })) }] : [];
  }).slice(0, 5);
  const old = Date.now() - (cfg.retire_after_days || 60) * 86400000;
  const retire_suggestions = activeArtifacts(base)
    .filter((a) => a.trust.success === 0 && Date.parse(a.created) < old)
    .map((a) => ({ id: a.id, type: a.type, name: a.name, text: a.text, created: a.created }));
  return {
    ripe: ripeClusters(base, cfg).slice(0, 5).map((c) => ({ category: c.category, ids: c.ids, lesson: c.seed, suggested_level: c.suggested_level, existing_artifact: c.existing_artifact,
      next_action: c.existing_artifact ? 'fix_artifact_then_feedback_correction' : 'confirm_same_lesson_then_apply_rule' })),
    escalations,
    candidates: pickCandidates(base, { project, limit: cfg.candidates_per_session || 3, aliases: cfg.path_aliases }),
    retire_suggestions,
    counts: { open: all.filter((r) => r.status === 'open').length, pending_candidates: loadQueue(base).length },
    how: '후보는 사용자의 현재 요청을 끝낸 뒤 처리: 각 candidate는 log(candidate_id=…)로 기록하거나 dismiss. ripe는 같은 교훈인지 확인 후 apply_rule.',
  };
}

export function dismissRecord(base, { candidate_id }) {
  return { dismissed: dismissCandidate(base, candidate_id), candidate_id };
}

export { STATUSES };
