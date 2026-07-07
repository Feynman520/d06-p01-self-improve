import { ensureDirs, nextId, saveRecord, listRecords, updateRecord } from './store.js';
import { findRelated } from './similar.js';

export const CATEGORIES = ['오해', '지식 부족', '도구 실패', '환경 문제', '반복 비효율'];

export function logRecord(base, input, today = new Date().toISOString().slice(0, 10)) {
  if (!CATEGORIES.includes(input.category)) {
    throw new Error(`category must be one of: ${CATEGORIES.join(', ')}`);
  }
  if (!input.lesson || !String(input.lesson).trim()) {
    throw new Error('lesson is required — one generalized sentence you can reuse next time');
  }
  ensureDirs(base);
  const related = findRelated(listRecords(base), input);
  const record = {
    id: nextId(base, today),
    date: today,
    project: input.project || '',
    category: input.category,
    status: 'open',
    related: related.join(', '),
    resolution: '',
    sections: {
      happened: input.what_happened || '',
      wanted: input.user_wanted || '',
      lesson: String(input.lesson).trim(),
      candidates: input.solution_candidates || '',
    },
  };
  const file = saveRecord(base, record);
  return { id: record.id, file, related };
}

const summarize = (r) => ({
  id: r.id, date: r.date, category: r.category, status: r.status,
  project: r.project, lesson: r.sections?.lesson || '', related: r.related || '', resolution: r.resolution || '',
});

export function searchRecords(base, q = {}) {
  const kw = (q.keyword || '').toLowerCase();
  return listRecords(base)
    .filter((r) =>
      (!q.category || r.category === q.category) &&
      (!q.status || r.status === q.status) &&
      (!q.project || (r.project || '').toLowerCase().includes(q.project.toLowerCase())) &&
      (!kw || [r.sections?.happened, r.sections?.wanted, r.sections?.lesson, r.sections?.candidates, r.project]
        .join(' ').toLowerCase().includes(kw)))
    .map(summarize);
}

export function statsRecords(base) {
  const all = listRecords(base);
  const by = (f) => all.reduce((m, r) => {
    const k = f(r) || '(없음)';
    m[k] = (m[k] || 0) + 1;
    return m;
  }, {});
  return {
    storage_dir: base,
    total: all.length,
    open: all.filter((r) => r.status === 'open').length,
    resolved: all.filter((r) => r.status === 'resolved').length,
    by_category: by((r) => r.category),
    by_project: by((r) => r.project),
    by_month: by((r) => (r.date || '').slice(0, 7)),
    last_record_date: all.map((r) => r.date).sort().pop() || null,
  };
}

export function resolveRecords(base, { ids = [], resolution = '' }) {
  const resolved = [];
  const not_found = [];
  for (const id of ids) {
    (updateRecord(base, id, { status: 'resolved', resolution }) ? resolved : not_found).push(id);
  }
  return { resolved, not_found };
}
