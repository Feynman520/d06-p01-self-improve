import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseClaude, parseCodex, extract, mine, linkSessions, loadQueue, takeCandidate, dismissCandidate, pickCandidates, CORRECTION_RE } from '../server/lib/mine.js';
import { createRecord, listRecords } from '../server/lib/store.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'si-')); }
const J = (o) => JSON.stringify(o);

function claudeTranscript(dir, cwd) {
  const sid = 'aaaa-1111';
  const ts = (m) => `2026-09-01T10:${String(m).padStart(2, '0')}:00.000Z`;
  const lines = [
    J({ type: 'permission-mode', sessionId: sid }),
    J({ type: 'user', sessionId: sid, cwd, timestamp: ts(0), message: { role: 'user', content: '보고서 만들어줘' } }),
    J({ type: 'assistant', sessionId: sid, cwd, timestamp: ts(1), message: { role: 'assistant', content: [{ type: 'text', text: '줄글로 정리했습니다.' }, { type: 'tool_use', name: 'Write', input: {} }] } }),
    J({ type: 'user', sessionId: sid, cwd, timestamp: ts(2), message: { role: 'user', content: [{ type: 'tool_result', content: 'Error: EACCES permission denied', is_error: true }] } }),
    J({ type: 'assistant', sessionId: sid, cwd, timestamp: ts(3), message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: {} }, { type: 'tool_use', name: 'Read', input: {} }] } }),
    J({ type: 'user', sessionId: sid, cwd, timestamp: ts(4), message: { role: 'user', content: '아니, 표로 정리해줘. 앞으로는 항상 표로.' } }),
    J({ type: 'user', sessionId: sid, cwd, timestamp: ts(5), isSidechain: true, message: { role: 'user', content: '아니 이건 서브에이전트 메시지' } }),
  ];
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${sid}.jsonl`), lines.join('\n') + '\n', 'utf8');
}
function codexTranscript(dir, cwd) {
  const sid = 'bbbb-2222';
  const lines = [
    J({ timestamp: '2026-09-02T10:00:00.000Z', type: 'session_meta', payload: { session_id: sid, id: sid, cwd } }),
    J({ timestamp: '2026-09-02T10:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>x</environment_context>' }, { type: 'input_text', text: '테스트 돌려' }] } }),
    J({ timestamp: '2026-09-02T10:00:02.000Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', input: 'npm test' } }),
    J({ timestamp: '2026-09-02T10:00:03.000Z', type: 'response_item', payload: { type: 'custom_tool_call_output', output: 'Traceback (most recent call last)\n  boom' } }),
    J({ timestamp: '2026-09-02T10:00:04.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '우회했습니다' }] } }),
    J({ timestamp: '2026-09-02T10:00:05.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'do it again, that is wrong' }] } }),
  ];
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `rollout-${sid}.jsonl`), lines.join('\n') + '\n', 'utf8');
}

test('CORRECTION_RE: 정정·규칙 선언 문구', () => {
  for (const s of ['아니, 그게 아니라', '다시 만들어줘', '앞으로는 표로', 'No, not that', 'from now on use tables', '왜 삭제했어']) assert.ok(CORRECTION_RE.test(s), s);
  for (const s of ['좋아 고마워', '다음 파일도 부탁해', 'looks good']) assert.ok(!CORRECTION_RE.test(s), s);
});

test('parseClaude + extract: 정정·도구 오류 추출, 사이드체인 제외, 3-gram', async () => {
  const dir = tmp();
  const cwd = path.join(dir, 'proj');
  claudeTranscript(path.join(dir, 'projects', 'p'), cwd);
  const s = await parseClaude(path.join(dir, 'projects', 'p', 'aaaa-1111.jsonl'));
  assert.equal(s.session_id, 'aaaa-1111');
  assert.equal(s.cwd, cwd);
  assert.equal(s.turns.filter((t) => t.role === 'user').length, 2);
  const { candidates, ngrams } = extract(s);
  assert.deepEqual(candidates.map((c) => c.kind), ['tool_error', 'correction']);
  assert.equal(candidates[0].tool, 'Write');
  assert.equal(candidates[1].suggested_category, '지식 부족');
  assert.match(candidates[1].excerpt, /\[사용자\] 아니, 표로/);
  assert.deepEqual(ngrams, ['Write>Bash>Read']);
});

test('parseCodex + extract', async () => {
  const dir = tmp();
  codexTranscript(path.join(dir, 'sessions', '2026', '09', '02'), 'C:\\x');
  const s = await parseCodex(path.join(dir, 'sessions', '2026', '09', '02', 'rollout-bbbb-2222.jsonl'));
  assert.equal(s.agent, 'codex');
  assert.equal(s.cwd, 'C:\\x');
  assert.deepEqual(s.turns.map((t) => t.role), ['user', 'tool_use', 'tool', 'assistant', 'user']);
  const { candidates } = extract(s);
  assert.deepEqual(candidates.map((c) => c.kind), ['tool_error', 'correction']);
  assert.equal(candidates[0].tool, 'exec');
});

test('mine: 두 에이전트 채굴 → 대기열, 재실행 시 변경 없는 파일 건너뜀, 세션 연결, take/dismiss', async () => {
  const base = tmp();
  const dir = tmp();
  const cwd = path.join(dir, 'proj');
  fs.mkdirSync(cwd);
  claudeTranscript(path.join(dir, 'claude', 'projects', 'p'), cwd);
  codexTranscript(path.join(dir, 'codex', 'sessions', '2026', '09', '02'), cwd);
  const cfg = { mine_days: 36500, agents: { claude: { transcripts: path.join(dir, 'claude', 'projects') }, codex: { transcripts: path.join(dir, 'codex', 'sessions') } } };
  const s1 = await mine(base, cfg);
  assert.equal(s1.files_scanned, 2);
  assert.equal(s1.candidates_added, 4);
  assert.equal(loadQueue(base).length, 4);
  const s2 = await mine(base, cfg);
  assert.equal(s2.files_skipped, 2);
  assert.equal(s2.candidates_added, 0);
  // link a record made during the claude session
  createRecord(base, { date: '2026-09-01', ts: '2026-09-01T10:03:30.000Z', project: cwd, category: '오해', status: 'open', sections: { lesson: 'x' } }, '2026-09-01');
  createRecord(base, { date: '2026-09-01', ts: '2026-09-03T10:03:30.000Z', project: cwd, category: '오해', status: 'open', sections: { lesson: 'y' } }, '2026-09-01');
  assert.equal(linkSessions(base), 1);
  assert.equal(listRecords(base)[0].session, 'claude:aaaa-1111');
  const picked = pickCandidates(base, { project: cwd, limit: 2 });
  assert.equal(picked.length, 2);
  const id = picked[0].id;
  assert.ok(takeCandidate(base, id));
  assert.equal(loadQueue(base).length, 3);
  assert.equal(dismissCandidate(base, loadQueue(base)[0].id), true);
  assert.equal(loadQueue(base).length, 2);
  const s3 = await mine(base, cfg);
  assert.equal(s3.queue_size, 2, 'dismissed/taken candidates are not re-added');
});
