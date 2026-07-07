import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CATEGORIES, logRecord, searchRecords, statsRecords, resolveRecords } from '../server/lib/tools.js';

function tmpBase() { return fs.mkdtempSync(path.join(os.tmpdir(), 'si-')); }
const input = (over = {}) => ({
  category: '도구 실패', lesson: '표 포함 문서는 한글 변환이 실패한다',
  what_happened: 'hwp 변환 중 표 깨짐', user_wanted: '표 유지', solution_candidates: '우회 스크립트',
  project: 'C:\\proj-a', ...over,
});

test('CATEGORIES: 5종 고정', () => {
  assert.deepEqual(CATEGORIES, ['오해', '지식 부족', '도구 실패', '환경 문제', '반복 비효율']);
});

test('logRecord: 검증 — 잘못된 분류/빈 교훈 거부', () => {
  const b = tmpBase();
  assert.throws(() => logRecord(b, input({ category: '기타' })), /category/);
  assert.throws(() => logRecord(b, input({ lesson: ' ' })), /lesson/);
});

test('logRecord: 저장 + 같은 날 일련번호 증가 + 유사 기록 자동 연결', () => {
  const b = tmpBase();
  const r1 = logRecord(b, input(), '2026-07-07');
  assert.equal(r1.id, '2026-07-07-001');
  assert.deepEqual(r1.related, []);
  assert.ok(fs.existsSync(r1.file));
  const r2 = logRecord(b, input({ lesson: '표 있는 문서는 한글 변환 실패 우회가 필요하다' }), '2026-07-07');
  assert.equal(r2.id, '2026-07-07-002');
  assert.deepEqual(r2.related, ['2026-07-07-001']);
});

test('search: keyword/category/status/project 필터', () => {
  const b = tmpBase();
  logRecord(b, input(), '2026-07-07');
  logRecord(b, input({
    category: '오해', lesson: '보고서는 항상 표로 정리한다', project: 'C:\\proj-b',
    what_happened: '줄글로 정리했다', user_wanted: '표 형태 보고서', solution_candidates: '',
  }), '2026-07-07');
  assert.equal(searchRecords(b, {}).length, 2);
  assert.equal(searchRecords(b, { category: '오해' }).length, 1);
  assert.equal(searchRecords(b, { keyword: '변환' }).length, 1);
  assert.equal(searchRecords(b, { project: 'proj-b' }).length, 1);
  assert.equal(searchRecords(b, { status: 'resolved' }).length, 0);
});

test('stats + resolve', () => {
  const b = tmpBase();
  const r1 = logRecord(b, input(), '2026-07-07');
  logRecord(b, input({ category: '오해', lesson: '전혀 다른 주제의 교훈이다' }), '2026-07-07');
  const out = resolveRecords(b, { ids: [r1.id, 'no-such'], resolution: 'CLAUDE.md 규칙 추가' });
  assert.deepEqual(out.resolved, [r1.id]);
  assert.deepEqual(out.not_found, ['no-such']);
  const s = statsRecords(b);
  assert.equal(s.total, 2);
  assert.equal(s.open, 1);
  assert.equal(s.resolved, 1);
  assert.equal(s.by_category['도구 실패'], 1);
  assert.equal(s.by_month['2026-07'], 2);
  assert.equal(s.storage_dir, b);
  assert.equal(s.last_record_date, '2026-07-07');
});
