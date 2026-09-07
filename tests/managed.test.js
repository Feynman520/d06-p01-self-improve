import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureBlock, upsertRule, removeRule, readRules, hasRule } from '../server/lib/managed.js';
import { pickLevel, commonAncestor, normalizePath, ensureInstructionFile } from '../server/lib/paths.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'si-')); }

test('managed block: 사람 글 보존, 규칙 추가/제거, CRLF 유지, 상한', () => {
  const f = path.join(tmp(), 'AGENTS.md');
  fs.writeFileSync(f, '# 제목\r\n\r\n사람 규칙 1\r\n', 'utf8');
  ensureBlock(f, { instructions: '### 지시문\n- 하나' });
  upsertRule(f, { id: 'R-001', text: '규칙 A', records: ['x-1'] });
  upsertRule(f, { id: 'R-002', text: '규칙 B' });
  const text = fs.readFileSync(f, 'utf8');
  assert.match(text, /^# 제목\r\n\r\n사람 규칙 1\r\n/);
  assert.match(text, /### 지시문\r\n- 하나/);
  assert.match(text, /- \[R-001\] 규칙 A \(근거 기록: x-1\)\r\n- \[R-002\] 규칙 B\r\n<!-- self-improve:end -->/);
  assert.equal(readRules(f).rules.length, 2);
  assert.equal(hasRule(f, 'R-002'), true);
  upsertRule(f, { id: 'R-001', text: '규칙 A 개정' });
  assert.equal(readRules(f).rules.find((r) => r.id === 'R-001').text, '규칙 A 개정');
  assert.equal(removeRule(f, 'R-001'), true);
  assert.equal(removeRule(f, 'R-001'), false);
  assert.equal(readRules(f).instructions.startsWith('### 지시문'), true);
  assert.throws(() => upsertRule(f, { id: 'R-003', text: 'C' }, { cap: 1 }), /rule cap/);
  // human text after the block also survives
  fs.appendFileSync(f, '\r\n뒤에 쓴 사람 글\r\n');
  upsertRule(f, { id: 'R-004', text: 'D' });
  assert.match(fs.readFileSync(f, 'utf8'), /self-improve:end -->\r\n\r\n뒤에 쓴 사람 글/);
});

test('managed block: 파일이 없으면 만들고, 있고 구역이 없으면 끝에 붙인다', () => {
  const f = path.join(tmp(), 'CLAUDE.md');
  upsertRule(f, { id: 'R-001', text: 'A' });
  assert.match(fs.readFileSync(f, 'utf8'), /^<!-- self-improve:begin/);
  const g = path.join(tmp(), 'AGENTS.md');
  fs.writeFileSync(g, '# x\n', 'utf8');
  upsertRule(g, { id: 'R-001', text: 'A' });
  assert.match(fs.readFileSync(g, 'utf8'), /^# x\n\n<!-- self-improve:begin[\s\S]*end -->\n$/);
});

test('paths: 별칭 치환, 공통 조상, 레벨 선택', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# r\n');
  fs.mkdirSync(path.join(root, 'D1', 'P1'), { recursive: true });
  fs.mkdirSync(path.join(root, 'D1', 'P2'), { recursive: true });
  fs.writeFileSync(path.join(root, 'D1', 'AGENTS.md'), '# d1\n');
  const aliases = { 'X:\\old\\ws': root };
  assert.equal(normalizePath('X:/old/ws/D1/P1', aliases), path.join(root, 'D1', 'P1'));
  assert.equal(commonAncestor([path.join(root, 'D1', 'P1'), path.join(root, 'D1', 'P2')]), path.join(root, 'D1'));
  assert.equal(commonAncestor(['C:\\a', 'D:\\b']), null);
  assert.equal(pickLevel([path.join(root, 'D1', 'P1'), path.join(root, 'D1', 'P2')], { root }), path.join(root, 'D1'));
  assert.equal(pickLevel([path.join(root, 'D1', 'P1')], { root }), path.join(root, 'D1'), 'P1 has no file → climbs to D1');
  assert.equal(pickLevel(['X:/old/ws/D1/P1', path.join(root, 'D1', 'P2')], { root, aliases }), path.join(root, 'D1'));
  assert.equal(pickLevel(['C:\\nowhere\\x'], { root }), root, 'unknown paths fall back to root');
  assert.equal(pickLevel([os.tmpdir()], { root }), root, 'outside root → root');
  assert.equal(pickLevel([], {}), null);
  const created = ensureInstructionFile(path.join(root, 'D1', 'P2'));
  assert.equal(path.basename(created), 'AGENTS.md');
  assert.equal(fs.readFileSync(path.join(root, 'D1', 'P2', 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
});
