import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CATEGORIES, logRecord, searchRecords, statsRecords, resolveRecords, applyRule, revokeArtifact, feedbackArtifact, pendingWork, registerArtifact } from '../server/lib/tools.js';
import { saveConfig } from '../server/lib/store.js';
import { readRules } from '../server/lib/managed.js';
import { getArtifact } from '../server/lib/registry.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'si-')); }
// A fake workspace: root/AGENTS.md, root/proj-a, root/proj-b (no instruction files inside).
function workspace() {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# root\n\n사람이 쓴 규칙\n', 'utf8');
  fs.mkdirSync(path.join(root, 'proj-a'));
  fs.mkdirSync(path.join(root, 'proj-b'));
  return root;
}
function setup() {
  const base = tmp();
  const root = workspace();
  saveConfig(base, { root, agents: { claude: { skills: path.join(base, 'fake-claude', 'skills') }, codex: { skills: path.join(base, 'fake-codex', 'skills') } } });
  fs.mkdirSync(path.join(base, 'fake-claude'));
  fs.mkdirSync(path.join(base, 'fake-codex'));
  return { base, root };
}
const L1 = '큰 파일을 한 번의 Write로 만들면 응답 스트림이 끊기므로 조각으로 나눠 append로 이어붙인다';
const L2 = '대용량 산출물 파일은 한 번의 큰 Write로 생성하지 말고 작은 조각으로 나눠 append로 이어붙여 스트림 끊김을 막는다';
const L3 = '보고서는 항상 표로 정리한다고 사용자가 선언했다';
const input = (over = {}) => ({ category: '도구 실패', lesson: L1, what_happened: 'x', user_wanted: 'y', project: '', ...over });

test('CATEGORIES: 5종 고정', () => {
  assert.deepEqual(CATEGORIES, ['오해', '지식 부족', '도구 실패', '환경 문제', '반복 비효율']);
});

test('log: 검증 — 잘못된 분류 / 너무 짧은 교훈 거부', () => {
  const { base } = setup();
  assert.throws(() => logRecord(base, input({ category: '기타' })), /category/);
  assert.throws(() => logRecord(base, input({ lesson: '짧다' })), /lesson/);
});

test('log: 첫 기록은 ripe 없음, 같은 교훈 2회째에 ripe + 공통 조상 레벨 제안', () => {
  const { base, root } = setup();
  const a = logRecord(base, input({ project: path.join(root, 'proj-a') }), '2026-07-07');
  assert.equal(a.id, '2026-07-07-001');
  assert.equal(a.ripe, null);
  const b = logRecord(base, input({ lesson: L2, project: path.join(root, 'proj-b') }), '2026-07-07');
  assert.ok(b.ripe, 'second occurrence must be ripe');
  assert.deepEqual(b.ripe.ids, [a.id, b.id]);
  assert.equal(b.ripe.threshold, 2);
  assert.equal(path.resolve(b.ripe.suggested_level), path.resolve(root));
  assert.equal(b.ripe.next_action, 'confirm_same_lesson_then_apply_rule');
});

test('log: 오해 분류는 3회째에 익음', () => {
  const { base } = setup();
  logRecord(base, input({ category: '오해', lesson: L3 }), '2026-07-07');
  const b = logRecord(base, input({ category: '오해', lesson: L3 }), '2026-07-07');
  assert.equal(b.ripe, null);
  const c = logRecord(base, input({ category: '오해', lesson: L3 }), '2026-07-07');
  assert.equal(c.ripe.count, 3);
});

test('apply_rule: 관리 구역에 규칙 기입 + 기록 resolved + 대장 등록; revoke로 제거 + rejected', () => {
  const { base, root } = setup();
  const a = logRecord(base, input({ project: path.join(root, 'proj-a') }), '2026-07-07');
  const b = logRecord(base, input({ lesson: L2, project: path.join(root, 'proj-b') }), '2026-07-07');
  const r = applyRule(base, { record_ids: b.ripe.ids, rule_text: '큰 파일은 조각으로 나눠 append로 쓴다' });
  assert.equal(r.rule_id, 'R-001');
  assert.equal(path.resolve(r.file), path.resolve(root, 'AGENTS.md'));
  const text = fs.readFileSync(r.file, 'utf8');
  assert.match(text, /사람이 쓴 규칙/);
  assert.match(text, /self-improve:begin/);
  assert.match(text, /\[R-001\] 큰 파일은 조각으로 나눠 append로 쓴다 \(근거 기록: 2026-07-07-001, 2026-07-07-002\)/);
  assert.match(text, /자기개선\(self-improve\) 지시문/, 'root block carries the instructions');
  assert.equal(searchRecords(base, { status: 'resolved' }).length, 2);
  assert.equal(getArtifact(base, 'R-001').records.length, 2);
  // same lesson again → covered by existing artifact, not a new rule
  assert.throws(() => applyRule(base, { record_ids: [a.id], rule_text: L1 }), /already covered/);
  const v = revokeArtifact(base, { id: 'R-001' });
  assert.equal(v.removed, true);
  assert.equal(readRules(r.file).rules.length, 0);
  assert.match(fs.readFileSync(r.file, 'utf8'), /사람이 쓴 규칙/);
  assert.equal(searchRecords(base, { status: 'rejected' }).length, 2);
  // rejected records no longer count towards ripeness
  const c = logRecord(base, input(), '2026-07-08');
  assert.equal(c.ripe, null);
});

test('apply_rule: 하위 프로젝트에 지시 파일이 없으면 상위(루트)로 올라가고, 있으면 그 폴더에 쓴다', () => {
  const { base, root } = setup();
  fs.writeFileSync(path.join(root, 'proj-a', 'CLAUDE.md'), '# a\n', 'utf8');
  const a = logRecord(base, input({ project: path.join(root, 'proj-a') }), '2026-07-07');
  const b = logRecord(base, input({ lesson: L2, project: path.join(root, 'proj-a') }), '2026-07-07');
  const r = applyRule(base, { record_ids: b.ripe.ids, rule_text: '큰 파일은 조각으로 쓴다 (proj-a 한정)' });
  assert.equal(path.resolve(r.file), path.resolve(root, 'proj-a', 'CLAUDE.md'));
  assert.doesNotMatch(fs.readFileSync(r.file, 'utf8'), /지시문/, 'non-root block has no instructions');
  void a;
});

test('resolve: artifact_id가 규칙이면 파일에 실재해야 통과', () => {
  const { base, root } = setup();
  const a = logRecord(base, input({ project: root }), '2026-07-07');
  const b = logRecord(base, input({ lesson: L2, project: root }), '2026-07-07');
  const r = applyRule(base, { record_ids: [a.id], rule_text: '큰 파일은 조각으로 쓴다' });
  assert.deepEqual(resolveRecords(base, { ids: [b.id], resolution: 'same rule', artifact_id: r.artifact_id }).resolved, [b.id]);
  fs.writeFileSync(r.file, '# wiped\n', 'utf8');
  assert.throws(() => resolveRecords(base, { ids: [b.id], resolution: 'x', artifact_id: r.artifact_id }), /not present/);
});

test('log: 해결된 교훈이 재발하면 recurrence_of_resolved + 격상 안내', () => {
  const { base, root } = setup();
  const a = logRecord(base, input({ project: root }), '2026-07-07');
  const b = logRecord(base, input({ lesson: L2, project: root }), '2026-07-07');
  applyRule(base, { record_ids: b.ripe.ids, rule_text: '큰 파일은 조각으로 쓴다' });
  const c = logRecord(base, input({ project: root }), '2026-07-09');
  assert.equal(c.recurrence_of_resolved.length, 2);
  assert.equal(c.recurrence_of_resolved[0].artifact.rule_id, 'R-001');
  assert.match(c.next_action, /escalate/);
  const p = pendingWork(base, {});
  assert.equal(p.escalations.length, 1);
  void a;
});

test('register_artifact(skill): 중앙 스킬을 두 에이전트 폴더로 동기화, revoke 시 제거', () => {
  const { base, root } = setup();
  const a = logRecord(base, input({ project: root }), '2026-07-07');
  const dir = path.join(base, 'skills', 'chunked-write');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: chunked-write\ndescription: 큰 파일 조각 쓰기\n---\n# 절차\n', 'utf8');
  const r = registerArtifact(base, { type: 'skill', name: 'chunked-write', record_ids: [a.id], description: '큰 파일 조각 쓰기 절차' });
  assert.equal(r.synced.length, 2);
  for (const s of r.synced) assert.ok(fs.existsSync(path.join(s.path, 'SKILL.md')));
  assert.equal(searchRecords(base, { status: 'resolved' }).length, 1);
  revokeArtifact(base, { query: 'chunked-write' });
  for (const s of r.synced) assert.ok(!fs.existsSync(s.path));
  assert.ok(!fs.existsSync(dir));
});

test('register_artifact(script): 가드 없는 스크립트 거부, 가드 있으면 등록; 성공 3회 → trusted 마커', () => {
  const { base } = setup();
  const p = path.join(base, 'scripts', 'fix.mjs');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 'console.log(1)\n', 'utf8');
  assert.throws(() => registerArtifact(base, { type: 'script', name: 'fix.mjs' }), /guard/);
  fs.writeFileSync(p, "import { guard } from './_guard.mjs';\nconst g = guard(import.meta.url);\n", 'utf8');
  const r = registerArtifact(base, { type: 'script', name: 'fix.mjs', description: 'x' });
  for (let i = 0; i < 3; i++) feedbackArtifact(base, { artifact_id: r.artifact_id, outcome: 'success' });
  assert.ok(fs.existsSync(`${p}.trusted`));
});

test('feedback: 성공 0회에 지적 2회면 퇴역 + 기록은 open으로 복귀', () => {
  const { base, root } = setup();
  const a = logRecord(base, input({ project: root }), '2026-07-07');
  const b = logRecord(base, input({ lesson: L2, project: root }), '2026-07-07');
  const r = applyRule(base, { record_ids: b.ripe.ids, rule_text: '큰 파일은 조각으로 쓴다' });
  feedbackArtifact(base, { artifact_id: r.artifact_id, outcome: 'correction' });
  const f = feedbackArtifact(base, { artifact_id: r.artifact_id, outcome: 'correction' });
  assert.equal(f.retired, true);
  assert.equal(readRules(r.file).rules.length, 0);
  assert.equal(searchRecords(base, { status: 'open' }).length, 2);
  void a;
});

test('stats + pending: 재발률·산출물 수·익은 패턴', () => {
  const { base, root } = setup();
  logRecord(base, input({ project: root }), '2026-07-07');
  logRecord(base, input({ lesson: L2, project: root }), '2026-07-07');
  logRecord(base, input({ category: '오해', lesson: L3 }), '2026-07-07');
  const s = statsRecords(base);
  assert.equal(s.total, 3);
  assert.equal(s.recurrence.open_records_in_repeat_clusters, 2);
  assert.equal(s.recurrence.ripe_clusters, 1);
  assert.equal(s.recurrence.recurrence_rate, 66.7);
  const p = pendingWork(base, { project: root });
  assert.equal(p.ripe.length, 1);
  assert.equal(p.ripe[0].ids.length, 2);
  assert.equal(p.counts.open, 3);
});
