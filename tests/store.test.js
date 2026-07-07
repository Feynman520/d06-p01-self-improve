import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { baseDir, ensureDirs, nextId, serializeRecord, parseRecord, saveRecord, listRecords, updateRecord, deleteRecord, recordsDir } from '../server/lib/store.js';

function tmpBase() { return fs.mkdtempSync(path.join(os.tmpdir(), 'si-')); }
const sample = (over = {}) => ({
  id: '2026-07-07-001', date: '2026-07-07', project: 'C:\\proj', category: '오해',
  status: 'open', related: '', resolution: '',
  sections: { happened: '표가 깨졌다', wanted: '표 유지 변환', lesson: '표 포함 문서는 방식 B로 변환한다', candidates: 'CLAUDE.md 규칙' },
  ...over,
});

test('baseDir: env 우선, 기본은 cwd/.self-improve', () => {
  assert.equal(baseDir({ SELF_IMPROVE_DIR: 'D:\\central' }, 'C:\\x'), 'D:\\central');
  assert.equal(baseDir({}, 'C:\\x'), path.join('C:\\x', '.self-improve'));
});

test('nextId: 빈 폴더 001, 기존 있으면 +1, 다른 날짜 무시', () => {
  const b = tmpBase(); ensureDirs(b);
  assert.equal(nextId(b, '2026-07-07'), '2026-07-07-001');
  fs.writeFileSync(path.join(recordsDir(b), '2026-07-07-002.md'), 'x');
  fs.writeFileSync(path.join(recordsDir(b), '2026-07-06-009.md'), 'x');
  assert.equal(nextId(b, '2026-07-07'), '2026-07-07-003');
});

test('serialize → parse 왕복 보존', () => {
  const r = sample();
  const p = parseRecord(serializeRecord(r));
  assert.equal(p.id, r.id);
  assert.equal(p.category, '오해');
  assert.equal(p.sections.lesson, r.sections.lesson);
  assert.equal(p.sections.candidates, r.sections.candidates);
});

test('save/list/update/delete 라이프사이클', () => {
  const b = tmpBase();
  saveRecord(b, sample());
  saveRecord(b, sample({ id: '2026-07-07-002', category: '도구 실패' }));
  assert.equal(listRecords(b).length, 2);
  assert.ok(updateRecord(b, '2026-07-07-001', { status: 'resolved', resolution: 'CLAUDE.md 1줄' }));
  const r = listRecords(b).find(x => x.id === '2026-07-07-001');
  assert.equal(r.status, 'resolved');
  assert.equal(r.resolution, 'CLAUDE.md 1줄');
  assert.equal(r.sections.lesson, sample().sections.lesson);
  assert.equal(updateRecord(b, 'no-such-id', {}), false);
  assert.ok(deleteRecord(b, '2026-07-07-002'));
  assert.equal(listRecords(b).length, 1);
});
