import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { baseDir, nextId, serializeRecord, parseRecord, createRecord, listRecords, updateRecord, deleteRecord, withLock, loadConfig, saveConfig } from '../server/lib/store.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'si-')); }
const rec = (id) => ({
  id, date: '2026-07-07', ts: '2026-07-07T01:00:00.000Z', project: 'C:\\p', agent: 'claude', session: '', source: 'model', category: '오해', status: 'open', related: '', artifact: '', resolution: '',
  sections: { happened: 'a', wanted: 'b', lesson: 'c 교훈', candidates: 'd' },
});

test('baseDir: env 우선, 없으면 cwd/.self-improve', () => {
  assert.equal(baseDir({ SELF_IMPROVE_DIR: 'X:\\si' }, 'C:\\w'), 'X:\\si');
  assert.equal(baseDir({}, 'C:\\w'), path.join('C:\\w', '.self-improve'));
});

test('serialize/parse 왕복 + 옛 형식(필드 없음) 파싱', () => {
  const r = rec('2026-07-07-001');
  const back = parseRecord(serializeRecord(r));
  assert.equal(back.id, r.id);
  assert.equal(back.ts, r.ts);
  assert.equal(back.sections.lesson, 'c 교훈');
  const old = parseRecord('---\nid: x\ndate: 2026-07-07\ncategory: 오해\n---\n\n## 교훈\n\n옛 기록\n');
  assert.equal(old.status, 'open');
  assert.equal(old.sections.lesson, '옛 기록');
});

test('createRecord: wx 원자 생성 — 이미 있는 번호는 건너뛴다', () => {
  const b = tmp();
  const a = createRecord(b, rec(''), '2026-07-07');
  assert.equal(a.id, '2026-07-07-001');
  fs.writeFileSync(path.join(b, 'records', '2026-07-07-002.md'), serializeRecord(rec('2026-07-07-002')), 'utf8');
  const c = createRecord(b, rec(''), '2026-07-07');
  assert.equal(c.id, '2026-07-07-003');
  assert.equal(nextId(b, '2026-07-07'), '2026-07-07-004');
  assert.equal(listRecords(b).length, 3);
  assert.equal(updateRecord(b, c.id, { status: 'rejected' }), true);
  assert.equal(listRecords(b).find((r) => r.id === c.id).status, 'rejected');
  assert.equal(deleteRecord(b, c.id), true);
  assert.equal(deleteRecord(b, c.id), false);
});

test('withLock: 잠금 중첩 시 대기 후 획득, 예외 시 해제', () => {
  const b = tmp();
  let inner = false;
  withLock(b, 't', () => { inner = true; });
  assert.equal(inner, true);
  assert.throws(() => withLock(b, 't', () => { throw new Error('boom'); }), /boom/);
  assert.ok(!fs.existsSync(path.join(b, 'locks', 't.lock')), 'lock released after throw');
  fs.mkdirSync(path.join(b, 'locks', 'u.lock'), { recursive: true });
  assert.throws(() => withLock(b, 'u', () => 1, { timeoutMs: 120, staleMs: 60000 }), /lock timeout/);
});

test('config: 기본값 + 사용자 병합', () => {
  const b = tmp();
  const d = loadConfig(b, { CLAUDE_CONFIG_DIR: 'C:\\cc', CODEX_HOME: 'C:\\cx' });
  assert.equal(d.rule_cap, 30);
  assert.equal(d.agents.claude.skills, path.join('C:\\cc', 'skills'));
  saveConfig(b, { root: 'C:\\w', ripe_threshold: { '오해': 4 } });
  const c = loadConfig(b, { CLAUDE_CONFIG_DIR: 'C:\\cc', CODEX_HOME: 'C:\\cx' });
  assert.equal(c.root, 'C:\\w');
  assert.equal(c.ripe_threshold['오해'], 4);
  assert.equal(c.ripe_threshold.default, 2);
  assert.equal(c.agents.codex.transcripts, path.join('C:\\cx', 'sessions'));
});
