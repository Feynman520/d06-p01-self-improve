# self-improve 플러그인 v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 클로드코드 플러그인 self-improve v1 — 수정 순간 기록(MCP 도구 4개) + 항상-켜짐 감지 지침 + 스킬 2개 + 텔레메트리 — 구현·테스트 후 IRIS에 로컬 배포.

**Architecture:** 의존성 0개의 Node.js MCP 서버(stdio, 줄 단위 JSON-RPC)가 마크다운 파일 저장소(`SELF_IMPROVE_DIR` 또는 `<cwd>/.self-improve/`)를 다룬다. 감지 규칙은 MCP `instructions` 필드로 모든 세션에 상주. 텔레메트리는 Google Apps Script URL로 세탁본만 fire-and-forget POST. 스킬 2개는 마크다운.

**Tech Stack:** Node.js >= 18 (global fetch, node:test), 런타임 의존성 없음. 플러그인 명세 `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`.

## Global Constraints

- Node.js **>= 18**, ESM(`"type": "module"`), **런타임 npm 의존성 0개** (git clone 설치 후 npm install 없이 동작해야 함)
- 분류 5종 고정(한국어 canonical): `오해`, `지식 부족`, `도구 실패`, `환경 문제`, `반복 비효율`
- 기록 id 형식: `YYYY-MM-DD-NNN` (NNN = 날짜별 3자리 일련번호)
- 저장 위치: env `SELF_IMPROVE_DIR` → 없으면 `<cwd>/.self-improve/`; 하위 `records/`, `reports/`
- 텔레메트리: 기본 켜짐, env `SELF_IMPROVE_TELEMETRY`가 `0|off|false|no`면 꺼짐; URL 미설정이면 no-op; 전송 항목 = 분류·세탁된 교훈·처방 종류·버전·언어만 (원문·경로·이름 절대 불포함)
- 공개 저장소 전제: 코드·문서에 개인정보/학교 내부 정보 금지 (D06 규칙)
- 교훈(`lesson`) 필드는 필수 — 한 문장 테스트의 구조적 강제
- MIT 라이선스, README 영어 기본 + 한국어(`README.ko.md`)
- 배포 순서(스펙 §7): 로컬 IRIS 설치 먼저, 깃허브 공개는 2~4주 개밥먹기 후 (이 계획 범위 밖)

## File Structure

```
(project root)
├── .claude-plugin/
│   ├── plugin.json          # 플러그인 명세 (mcpServers 포함)
│   └── marketplace.json     # 단일 플러그인 마켓플레이스 (repo 주소 설치용)
├── server/
│   ├── index.js             # MCP stdio 서버 (JSON-RPC 루프 + instructions + 도구 스키마)
│   └── lib/
│       ├── store.js         # 파일 저장소: 경로 해석, id 생성, frontmatter 직렬화/파싱
│       ├── similar.js       # 유사 기록 검색 (토큰 겹침)
│       ├── tools.js         # 도구 4개 비즈니스 로직 (log/search/stats/resolve)
│       └── telemetry.js     # 텔레메트리 이벤트 조립 + 전송 게이트
├── skills/
│   ├── self-improve-log/SKILL.md
│   └── self-improve-report/SKILL.md
├── telemetry/apps-script.gs # 수신용 Google Apps Script (개발자 수동 배포)
├── docs/telemetry-setup.md  # GAS 배포 절차
├── tests/                   # node:test (store/tools/telemetry/server 통합)
├── package.json, LICENSE, README.md, README.ko.md, .gitignore
```

---

### Task 1: 스캐폴드 (package.json, 플러그인 명세, LICENSE)

**Files:**
- Create: `package.json`, `.gitignore`, `LICENSE`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`

**Interfaces:**
- Produces: `package.json`의 `version`(서버가 읽음), `${CLAUDE_PLUGIN_ROOT}/server/index.js` 진입점 경로 계약

- [ ] **Step 1: 파일 5개 작성**

`package.json`:
```json
{
  "name": "self-improve",
  "version": "0.1.0",
  "description": "Claude Code plugin: log the moments users correct Claude, find patterns, prescribe recurrence-prevention fixes",
  "type": "module",
  "private": true,
  "engines": { "node": ">=18" },
  "scripts": { "test": "node --test tests/" }
}
```

`.gitignore`:
```
node_modules/
.self-improve/
*.log
```

`LICENSE`: MIT 전문, `Copyright (c) 2026 Sejun Ham`.

`.claude-plugin/plugin.json`:
```json
{
  "name": "self-improve",
  "version": "0.1.0",
  "description": "Self-improvement loop for Claude Code: log user-correction moments, find patterns, prescribe fixes (CLAUDE.md rules / skills / scripts / MCP).",
  "author": { "name": "Sejun Ham" },
  "mcpServers": {
    "self-improve": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/server/index.js"]
    }
  }
}
```

`.claude-plugin/marketplace.json`:
```json
{
  "name": "self-improve",
  "owner": { "name": "Sejun Ham" },
  "plugins": [
    {
      "name": "self-improve",
      "source": "./",
      "description": "Self-improvement loop for Claude Code: log user-correction moments, find patterns, prescribe fixes."
    }
  ]
}
```

- [ ] **Step 2: 검증** — `node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json'))"` 통과, `npm test`가 "no tests" 로 종료(에러 아님).
- [ ] **Step 3: Commit** — `chore: scaffold plugin manifest and package`

### Task 2: store.js — 파일 저장소 (TDD)

**Files:**
- Create: `server/lib/store.js`, `tests/store.test.js`

**Interfaces:**
- Produces:
  - `baseDir(env?, cwd?) → string` — `SELF_IMPROVE_DIR` 우선, 기본 `<cwd>/.self-improve`
  - `recordsDir(base)`, `reportsDir(base)`, `ensureDirs(base)`
  - `nextId(base, date /* 'YYYY-MM-DD' */) → 'YYYY-MM-DD-NNN'`
  - `serializeRecord(record) → string`, `parseRecord(text) → record|null`
  - `saveRecord(base, record) → filePath`, `listRecords(base) → record[]`, `updateRecord(base, id, patch) → boolean`, `deleteRecord(base, id) → boolean`
  - record = `{id, date, project, category, status, related, resolution, sections: {happened, wanted, lesson, candidates}}` (related/resolution은 문자열, related는 쉼표 구분)

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/store.test.js`)

```js
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
  assert.equal(r.sections.lesson, sample().sections.lesson); // 본문 보존
  assert.equal(updateRecord(b, 'no-such-id', {}), false);
  assert.ok(deleteRecord(b, '2026-07-07-002'));
  assert.equal(listRecords(b).length, 1);
});
```

- [ ] **Step 2: 실행 → 실패 확인** — `npm test` → `Cannot find module .../store.js` FAIL
- [ ] **Step 3: 구현** (`server/lib/store.js`)

```js
import fs from 'node:fs';
import path from 'node:path';

const SECTION_KEYS = [
  ['happened', '무슨 일이 있었나'],
  ['wanted', '사용자가 진짜 원한 것'],
  ['lesson', '교훈'],
  ['candidates', '해결책 후보'],
];
const FM_KEYS = ['id', 'date', 'project', 'category', 'status', 'related', 'resolution'];

export function baseDir(env = process.env, cwd = process.cwd()) {
  const v = env.SELF_IMPROVE_DIR && env.SELF_IMPROVE_DIR.trim();
  return v || path.join(cwd, '.self-improve');
}
export const recordsDir = (base) => path.join(base, 'records');
export const reportsDir = (base) => path.join(base, 'reports');
export function ensureDirs(base) {
  fs.mkdirSync(recordsDir(base), { recursive: true });
  fs.mkdirSync(reportsDir(base), { recursive: true });
}

export function nextId(base, date) {
  const dir = recordsDir(base);
  let max = 0;
  if (fs.existsSync(dir)) {
    const re = new RegExp(`^${date}-(\\d{3})\\.md$`);
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(re);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  }
  return `${date}-${String(max + 1).padStart(3, '0')}`;
}

export function serializeRecord(r) {
  const fm = FM_KEYS.map((k) => `${k}: ${r[k] ?? ''}`).join('\n');
  const body = SECTION_KEYS
    .map(([key, title]) => `## ${title}\n\n${String(r.sections?.[key] ?? '').trim()}`)
    .join('\n\n');
  return `---\n${fm}\n---\n\n${body}\n`;
}

export function parseRecord(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const rec = { sections: {} };
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) rec[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  for (const [key, title] of SECTION_KEYS) {
    const sm = m[2].match(new RegExp(`## ${title}\\r?\\n([\\s\\S]*?)(?=\\r?\\n## |$)`));
    rec.sections[key] = sm ? sm[1].trim() : '';
  }
  return rec;
}

const fileOf = (base, id) => path.join(recordsDir(base), `${id}.md`);

export function saveRecord(base, record) {
  ensureDirs(base);
  const file = fileOf(base, record.id);
  fs.writeFileSync(file, serializeRecord(record), 'utf8');
  return file;
}

export function listRecords(base) {
  const dir = recordsDir(base);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => parseRecord(fs.readFileSync(path.join(dir, f), 'utf8')))
    .filter(Boolean)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export function updateRecord(base, id, patch) {
  const file = fileOf(base, id);
  if (!fs.existsSync(file)) return false;
  const rec = parseRecord(fs.readFileSync(file, 'utf8'));
  if (!rec) return false;
  Object.assign(rec, patch);
  fs.writeFileSync(file, serializeRecord(rec), 'utf8');
  return true;
}

export function deleteRecord(base, id) {
  const file = fileOf(base, id);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}
```

- [ ] **Step 4: 테스트 통과 확인** — `npm test` PASS
- [ ] **Step 5: Commit** — `feat: markdown record store`

### Task 3: similar.js — 유사 기록 자동 연결 (TDD)

**Files:**
- Create: `server/lib/similar.js`, `tests/similar.test.js`

**Interfaces:**
- Consumes: record 배열(store.js 형태)
- Produces: `tokenize(text) → string[]`, `findRelated(records, {lesson, category}, max=3) → id[]` (점수 = 교훈·경위 토큰 겹침 + 동일 분류 보너스 1, 3점 이상만)

- [ ] **Step 1: 실패하는 테스트** (`tests/similar.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, findRelated } from '../server/lib/similar.js';

const rec = (id, lesson, category = '도구 실패') => ({ id, category, sections: { lesson, happened: '' } });

test('tokenize: 한국어/영어 토큰, 2자 미만·불용어 제거, 중복 제거', () => {
  const t = tokenize('표 포함 HWP 문서는 변환 실패한다 변환');
  assert.ok(t.includes('변환'));
  assert.ok(t.includes('hwp'));
  assert.equal(t.filter((x) => x === '변환').length, 1);
});

test('findRelated: 유사 기록만 연결, 무관 기록 제외', () => {
  const records = [
    rec('a', '표 포함 문서는 한글 변환이 실패한다'),
    rec('b', '급식 메뉴 조회는 나이스 API를 쓴다', '지식 부족'),
  ];
  const out = findRelated(records, { lesson: '표 있는 문서 한글 변환 실패 시 우회 필요', category: '도구 실패' });
  assert.deepEqual(out, ['a']);
});

test('findRelated: 빈 저장소면 빈 배열', () => {
  assert.deepEqual(findRelated([], { lesson: '아무거나', category: '오해' }), []);
});
```

- [ ] **Step 2: 실행 → 실패 확인**
- [ ] **Step 3: 구현** (`server/lib/similar.js`)

```js
const STOP = new Set([
  'the', 'a', 'an', 'to', 'of', 'in', 'is', 'are', 'and', 'or', 'for', 'on', 'with', 'when',
  '것은', '것이', '경우', '하는', '있는', '한다', '했다', '된다', '해야', '때는', '그리고', '또는',
]);

export function tokenize(text) {
  return [...new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length >= 2 && !STOP.has(t)),
  )];
}

export function findRelated(records, { lesson, category }, max = 3) {
  const t = tokenize(lesson);
  return records
    .map((r) => {
      const rt = new Set(tokenize(`${r.sections?.lesson || ''} ${r.sections?.happened || ''}`));
      const overlap = t.filter((x) => rt.has(x)).length;
      return { id: r.id, score: overlap + (r.category === category ? 1 : 0), overlap };
    })
    .filter((x) => x.overlap >= 2 && x.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.id);
}
```

- [ ] **Step 4: 테스트 통과 확인**
- [ ] **Step 5: Commit** — `feat: similar-record matcher`

### Task 4: tools.js — 도구 4개 로직 (TDD)

**Files:**
- Create: `server/lib/tools.js`, `tests/tools.test.js`

**Interfaces:**
- Consumes: store.js 전부, similar.js `findRelated`
- Produces:
  - `CATEGORIES` — 분류 5종 배열
  - `logRecord(base, input, today?) → {id, file, related: id[]}` — category/lesson 검증, 유사 기록 자동 `related` 연결
  - `searchRecords(base, {keyword, category, project, status}) → summary[]` (summary = `{id, date, category, status, project, lesson, related, resolution}`)
  - `statsRecords(base) → {storage_dir, total, open, resolved, by_category, by_project, by_month, last_record_date}`
  - `resolveRecords(base, {ids, resolution}) → {resolved: id[], not_found: id[]}`

- [ ] **Step 1: 실패하는 테스트** (`tests/tools.test.js`)

```js
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
  logRecord(b, input({ category: '오해', lesson: '보고서는 항상 표로 정리한다', project: 'C:\\proj-b' }), '2026-07-07');
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
```

- [ ] **Step 2: 실행 → 실패 확인**
- [ ] **Step 3: 구현** (`server/lib/tools.js`)

```js
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
```

- [ ] **Step 4: 테스트 통과 확인**
- [ ] **Step 5: Commit** — `feat: log/search/stats/resolve tool logic`

### Task 5: telemetry.js — 세탁본 전송 (TDD)

**Files:**
- Create: `server/lib/telemetry.js`, `tests/telemetry.test.js`

**Interfaces:**
- Produces:
  - `TELEMETRY_URL` — 상수(GAS 배포 전까지 `''` → 전체 no-op)
  - `telemetryEnabled(env, url) → boolean`
  - `buildLogEvent({category, lesson_anonymized, version, language})` / `buildResolveEvent({prescription, version})`
  - `send(event, {env, url, fetchFn}) → Promise<boolean>` — fire-and-forget, 오류 무시

- [ ] **Step 1: 실패하는 테스트** (`tests/telemetry.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { telemetryEnabled, buildLogEvent, buildResolveEvent, send } from '../server/lib/telemetry.js';

const URL = 'https://script.google.com/macros/s/x/exec';

test('telemetryEnabled: URL 없으면 항상 꺼짐, env로 끄기 가능, 기본 켜짐', () => {
  assert.equal(telemetryEnabled({}, ''), false);
  assert.equal(telemetryEnabled({ SELF_IMPROVE_TELEMETRY: 'off' }, URL), false);
  assert.equal(telemetryEnabled({ SELF_IMPROVE_TELEMETRY: '0' }, URL), false);
  assert.equal(telemetryEnabled({}, URL), true);
});

test('buildLogEvent: 허용 필드만 포함(원문·경로 없음)', () => {
  const e = buildLogEvent({ category: '오해', lesson_anonymized: '표 포함 문서 변환 주의', version: '0.1.0', language: 'ko' });
  assert.deepEqual(Object.keys(e).sort(), ['category', 'lesson', 'ts', 'type', 'version', 'language'].sort());
  assert.equal(e.type, 'log');
});

test('send: 켜져 있으면 POST 1회, fetch 실패해도 예외 없음', async () => {
  let called = 0;
  const ok = await send(buildResolveEvent({ prescription: 'claude_md', version: '0.1.0' }), {
    env: {}, url: URL,
    fetchFn: async (u, opts) => { called++; assert.equal(opts.method, 'POST'); JSON.parse(opts.body); return { ok: true }; },
  });
  assert.equal(ok, true);
  assert.equal(called, 1);
  const bad = await send({ type: 'log' }, { env: {}, url: URL, fetchFn: async () => { throw new Error('net'); } });
  assert.equal(bad, false);
  const off = await send({ type: 'log' }, { env: { SELF_IMPROVE_TELEMETRY: 'off' }, url: URL, fetchFn: async () => { called++; } });
  assert.equal(off, false);
  assert.equal(called, 1);
});
```

- [ ] **Step 2: 실행 → 실패 확인**
- [ ] **Step 3: 구현** (`server/lib/telemetry.js`)

```js
// GAS(Google Apps Script) 웹앱 배포 후 URL을 여기에 넣는다. 비어 있으면 텔레메트리 전체 no-op.
export const TELEMETRY_URL = '';

export function telemetryEnabled(env = process.env, url = TELEMETRY_URL) {
  if (!url) return false;
  const v = String(env.SELF_IMPROVE_TELEMETRY || '').toLowerCase();
  return !['0', 'off', 'false', 'no'].includes(v);
}

export function buildLogEvent({ category, lesson_anonymized, version, language }) {
  return {
    type: 'log',
    category: category || '',
    lesson: lesson_anonymized || '',
    version: version || '',
    language: language || '',
    ts: new Date().toISOString(),
  };
}

export function buildResolveEvent({ prescription, version }) {
  return { type: 'resolve', prescription: prescription || '', version: version || '', ts: new Date().toISOString() };
}

export async function send(event, { env = process.env, url = TELEMETRY_URL, fetchFn = fetch } = {}) {
  if (!telemetryEnabled(env, url)) return false;
  try {
    await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**
- [ ] **Step 5: Commit** — `feat: laundered telemetry sender (off until endpoint set)`

### Task 6: server/index.js — MCP stdio 서버 + 통합 테스트

**Files:**
- Create: `server/index.js`, `tests/server.test.js`

**Interfaces:**
- Consumes: tools.js 4함수 + CATEGORIES, telemetry.js, store.js `baseDir`/`deleteRecord`
- Produces: stdio JSON-RPC(줄 단위) MCP 서버 — `initialize`(instructions 포함), `tools/list`(4개), `tools/call`, `ping`. 도구 실행 오류는 `isError: true` content로 반환.

- [ ] **Step 1: 구현** (`server/index.js`) — 프로토콜 루프는 통합 테스트로 검증(단위 TDD 부적합)

```js
#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseDir } from './lib/store.js';
import { CATEGORIES, logRecord, searchRecords, statsRecords, resolveRecords } from './lib/tools.js';
import { send, buildLogEvent, buildResolveEvent } from './lib/telemetry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;

const INSTRUCTIONS = `self-improve is active: capture the moments your output missed what the user really wanted.

Call the \`log\` tool immediately AFTER finishing the user's current request when you notice:
1. The user corrected or redid your result ("no, not that", "do it again") → 오해 or 지식 부족
2. The user declared a future rule ("from now on, always ...") → 지식 부족
3. A tool/command failed and you worked around it → 도구 실패 or 환경 문제
4. The same manual work repeated yet again → 반복 비효율

Do NOT log: brand-new requests, one-off taste tweaks. One-sentence test: if you cannot state a reusable lesson in ONE sentence, do not log.

When logging, fill \`lesson\` (one generalized sentence, required) and \`lesson_anonymized\` (same lesson with every name/path/email/file content removed). After logging, print exactly one line: 📝 개선점 기록: "<lesson>" (<category>). If the user objects, delete the record file immediately.

If a few CLAUDE.md lines would prevent recurrence, propose them right away; once the user approves and you apply them, call \`resolve\` on the record.`;

const TOOLS = [
  {
    name: 'log',
    description: 'Save a self-improvement record (a moment where the result missed what the user wanted). Auto-links similar past records via `related`.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: CATEGORIES, description: '오해=misread request, 지식 부족=missing user/env fact, 도구 실패=tool failure, 환경 문제=config/path/permission, 반복 비효율=repeated manual work' },
        lesson: { type: 'string', description: 'REQUIRED. One generalized sentence reusable next time.' },
        what_happened: { type: 'string', description: 'What happened (facts).' },
        user_wanted: { type: 'string', description: 'What the user really wanted.' },
        solution_candidates: { type: 'string', description: 'Candidate fixes (CLAUDE.md rule / skill / script / MCP).' },
        project: { type: 'string', description: 'Absolute path of the project folder where this happened (cwd).' },
        lesson_anonymized: { type: 'string', description: 'Lesson with all names/paths/emails/file contents removed. Used for anonymous telemetry only.' },
        language: { type: 'string', description: 'Conversation language code, e.g. ko, en.' },
      },
      required: ['category', 'lesson'],
    },
  },
  {
    name: 'search',
    description: 'Search self-improvement records by keyword/category/project/status.',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string' },
        category: { type: 'string', enum: CATEGORIES },
        project: { type: 'string', description: 'Substring match on project path.' },
        status: { type: 'string', enum: ['open', 'resolved'] },
      },
    },
  },
  {
    name: 'stats',
    description: 'Aggregate self-improvement records by category/project/month, plus storage location.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'resolve',
    description: 'Mark records resolved with the applied fix. Accepts multiple ids.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' } },
        resolution: { type: 'string', description: 'The fix that was applied.' },
        prescription_type: { type: 'string', enum: ['claude_md', 'skill', 'script', 'library', 'mcp', 'other'], description: 'Kind of fix, for anonymous telemetry.' },
      },
      required: ['ids', 'resolution'],
    },
  },
];

function callTool({ name, arguments: args = {} }) {
  const base = baseDir();
  switch (name) {
    case 'log': {
      const result = logRecord(base, args);
      send(buildLogEvent({ category: args.category, lesson_anonymized: args.lesson_anonymized, version: VERSION, language: args.language }));
      return result;
    }
    case 'search': return searchRecords(base, args);
    case 'stats': return statsRecords(base);
    case 'resolve': {
      const result = resolveRecords(base, args);
      send(buildResolveEvent({ prescription: args.prescription_type, version: VERSION }));
      return result;
    }
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

function handle(msg) {
  switch (msg.method) {
    case 'initialize':
      return {
        protocolVersion: msg.params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'self-improve', version: VERSION },
        instructions: INSTRUCTIONS,
      };
    case 'tools/list':
      return { tools: TOOLS };
    case 'tools/call':
      try {
        return { content: [{ type: 'text', text: JSON.stringify(callTool(msg.params), null, 2) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e.message || e}` }], isError: true };
      }
    case 'ping':
      return {};
    default:
      throw Object.assign(new Error(`Method not found: ${msg.method}`), { code: -32601 });
  }
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try { msg = JSON.parse(trimmed); } catch { return; }
  if (msg.id === undefined) return; // notification — nothing to answer
  try {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: handle(msg) }) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: e.code || -32000, message: String(e.message || e) } }) + '\n');
  }
});
```

- [ ] **Step 2: 통합 테스트 작성** (`tests/server.test.js`) — 자식 프로세스로 서버 띄워 왕복 검증

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'index.js');

function rpc(proc, msg) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('rpc timeout')), 5000);
    let buf = '';
    const onData = (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl >= 0) {
        clearTimeout(timer);
        proc.stdout.off('data', onData);
        resolve(JSON.parse(buf.slice(0, nl)));
      }
    };
    proc.stdout.on('data', onData);
    proc.stdin.write(JSON.stringify(msg) + '\n');
  });
}

test('MCP handshake → tools/list → log → search 왕복', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-srv-'));
  const proc = spawn(process.execPath, [serverPath], { env: { ...process.env, SELF_IMPROVE_DIR: dir }, stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    const init = await rpc(proc, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
    assert.equal(init.result.serverInfo.name, 'self-improve');
    assert.match(init.result.instructions, /log/);

    const list = await rpc(proc, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.deepEqual(list.result.tools.map((t) => t.name).sort(), ['log', 'resolve', 'search', 'stats']);

    const logRes = await rpc(proc, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'log', arguments: { category: '오해', lesson: '보고서는 표 형태를 기본으로 한다', project: 'C:\\p' } } });
    const logged = JSON.parse(logRes.result.content[0].text);
    assert.match(logged.id, /^\d{4}-\d{2}-\d{2}-001$/);
    assert.ok(fs.existsSync(path.join(dir, 'records', `${logged.id}.md`)));

    const bad = await rpc(proc, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'log', arguments: { category: '없는분류', lesson: 'x y z' } } });
    assert.equal(bad.result.isError, true);

    const searchRes = await rpc(proc, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'search', arguments: { status: 'open' } } });
    assert.equal(JSON.parse(searchRes.result.content[0].text).length, 1);
  } finally {
    proc.kill();
  }
});
```

- [ ] **Step 3: 전체 테스트 통과 확인** — `npm test` PASS (전 스위트)
- [ ] **Step 4: Commit** — `feat: MCP stdio server with always-on detection instructions`

### Task 7: 스킬 2개

**Files:**
- Create: `skills/self-improve-log/SKILL.md`, `skills/self-improve-report/SKILL.md`

**Interfaces:**
- Consumes: MCP 도구 `log`/`search`/`stats`/`resolve` (플러그인 설치 시 `mcp__self-improve__*`)

- [ ] **Step 1: self-improve-log 작성**

```markdown
---
name: self-improve-log
description: Manually log a self-improvement record right now. Use when the user runs /self-improve-log or says "이거 기록해", "개선점 기록", "log this".
---

# self-improve-log — 수동 즉시 기록

방금 대화에서 드러난 개선점 1건을 self-improve MCP의 `log` 도구로 기록한다.

## 절차

1. **대상 특정** — 사용자가 인자로 지목했으면 그것을, 아니면 직전 대화에서 "결과가 사용자 의도와 어긋났던 순간"을 찾는다. 못 찾으면 무엇을 기록할지 한 번만 묻는다.
2. **한 문장 테스트** — 다음에도 써먹을 교훈을 한 문장으로 쓸 수 있는가? 못 쓰면 기록 대상이 아니라고 답하고 중단한다.
3. **분류 선택** (5종 고정): 오해(요구 오해) / 지식 부족(사용자·환경 고유 사실) / 도구 실패 / 환경 문제(설정·경로·권한) / 반복 비효율(자동화 후보)
4. **`log` 도구 호출** — `category`, `lesson`(일반화된 한 문장), `what_happened`, `user_wanted`, `solution_candidates`, `project`(현재 작업 폴더 절대경로), `lesson_anonymized`(이름·경로·이메일·파일 내용 제거본), `language`.
5. **한 줄 알림**: `📝 개선점 기록: "<lesson>" (<category>)` — 반환된 `related`가 있으면 "유사 기록 n건과 연결됨"을 덧붙인다.
6. **즉시 제안** — 해결책이 CLAUDE.md 몇 줄 수준이면 바로 제안하고, 사용자가 승인해 적용하면 `resolve`(해당 id, resolution, prescription_type)까지 호출한다.
7. 사용자가 "기록하지 마"라고 하면 저장된 기록 파일을 즉시 삭제한다.
```

- [ ] **Step 2: self-improve-report 작성**

```markdown
---
name: self-improve-report
description: Periodic self-improvement report — load open records, group patterns, prescribe fixes via the prescription ladder. Use when the user runs /self-improve-report or asks "개선 보고서", "improvement report".
---

# self-improve-report — 정기 보고

open 기록 전체를 패턴으로 묶고, 처방 사다리로 재발 방지책을 제안·적용한다.

## 절차

1. **로드** — `stats` 호출(저장 위치 `storage_dir`·집계 확보) → `search`({status: "open"})로 open 기록 전체 확보. open 0건이면 "기록 없음 + 권장 주기 안내"만 출력하고 끝낸다.
2. **재발 감시 (최우선)** — 각 open 기록의 `related`에 있는 id를 `search`로 확인해 resolved 기록이 있으면, 보고서 최상단에 ⚠️ **처방 무효** 경고(그 처방이 재발을 못 막았다는 뜻)를 놓는다.
3. **패턴 묶기** — 같은 분류 + related 연결 + 교훈 유사성으로 기록을 그룹화한다. 예: "한글 변환 실패 3회, 전부 표 포함 문서".
4. **처방 사다리** — 각 패턴마다 반드시 가벼운 칸부터 검토하고, 더 무거운 칸은 가벼운 칸이 왜 부족한지 근거가 있을 때만 올라간다:
   ① CLAUDE.md 규칙 몇 줄 → ② 스킬 제작 → ③ 스크립트/외부 라이브러리 → ④ MCP 도입·제작
   CLAUDE.md 처방이면 어느 레벨(폴더)의 CLAUDE.md에 넣을지 적절한 스코프 위치를 근거와 함께 제시한다.
5. **보고서 출력 + 저장** — 처방마다 근거(기록 n건·id), 내용, 예상 효과, 적용 비용을 적고 **효과 대비 비용 순으로 정렬**한다. 기록이 0건인 달(공백 기간)이 있으면 "감지 누락 가능성"으로 표시한다. 같은 내용을 `<storage_dir>/reports/YYYY-MM-DD-보고.md` 파일로 저장한다.
6. **승인 → 적용 → 일괄 resolve** — 사용자가 승인한 처방을 적용한 뒤, 해당 패턴의 기록 id들을 `resolve`(ids, resolution, prescription_type)로 일괄 처리한다.
7. **말미 안내** — "권장: 기록 10건 이상 또는 2~4주마다 이 보고를 실행하세요."
```

- [ ] **Step 3: Commit** — `feat: manual-log and periodic-report skills`

### Task 8: 텔레메트리 수신부 (GAS 코드 + 셋업 문서)

**Files:**
- Create: `telemetry/apps-script.gs`, `docs/telemetry-setup.md`

- [ ] **Step 1: `telemetry/apps-script.gs`**

```js
// self-improve telemetry receiver — Google Apps Script Web App
// 배포: 스프레드시트 → 확장 프로그램 → Apps Script → 이 코드 붙여넣기 → 배포(웹 앱, 액세스: 모든 사용자)
function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('telemetry') || ss.insertSheet('telemetry');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['received_at', 'type', 'category', 'lesson', 'prescription', 'version', 'language', 'client_ts']);
  }
  var d = {};
  try { d = JSON.parse(e.postData.contents); } catch (err) {}
  sheet.appendRow([new Date(), d.type || '', d.category || '', d.lesson || '', d.prescription || '', d.version || '', d.language || '', d.ts || '']);
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}
```

- [ ] **Step 2: `docs/telemetry-setup.md`** — 개발자용: 시트 생성 → GAS 붙여넣기 → 웹 앱 배포(모든 사용자) → URL 복사 → `server/lib/telemetry.js`의 `TELEMETRY_URL`에 기입 → 버전 커밋. 스팸 위험(공개 URL)은 v1에선 시트 수동 필터로 감수(스펙 §6).
- [ ] **Step 3: Commit** — `feat: telemetry receiver script and setup guide`

### Task 9: README (영어 + 한국어)

**Files:**
- Create: `README.md`, `README.ko.md`

- [ ] **Step 1: README.md** — 섹션: What/Why(수정 순간 = 가장 값진 데이터), Install(`/plugin marketplace add <repo>` → `/plugin install self-improve@self-improve`), How it works(항상-켜짐 감지 4순간 + 노이즈 필터 + 하이브리드), Tools 4개 표, Skills 2개, Storage(`SELF_IMPROVE_DIR`, 기본 `.self-improve/`), 기록 포맷 예시, **Telemetry 절(전송 항목 전문 명시: type/category/anonymized lesson/prescription/version/language/timestamp — 그 외 어떤 것도 전송 안 함, 끄기 `SELF_IMPROVE_TELEMETRY=off`)**, Recommended cadence(10건 또는 2~4주), Roadmap v2(칭찬 기록·대시보드·전송 검증·훅 옵션), License MIT.
- [ ] **Step 2: README.ko.md** — 같은 내용 한국어 전문.
- [ ] **Step 3: Commit** — `docs: bilingual README with full telemetry disclosure`

### Task 10: IRIS 로컬 배포 (개밥먹기 1단계)

**Files:**
- Create: `C:\Users\User\Desktop\IRIS\_자기개선(Self-Improvement)\` (+ `records\`, `reports\`, `CLAUDE.md`)
- Modify: `~/.claude/settings.json` (env `SELF_IMPROVE_DIR`)
- Modify: `C:\Users\User\Desktop\IRIS\IRIS-구조지도.html`

- [ ] **Step 1: 중앙 폴더 + 초미니멀 CLAUDE.md 생성**

```markdown
# _자기개선(Self-Improvement)

IRIS 전역 self-improve 플러그인의 중앙 저장 폴더 — `records/` = 개선점 기록(마크다운 1건 1파일), `reports/` = 정기 보고서. 기록 파일은 self-improve MCP 도구로만 생성·수정한다.
<!-- 상위 CLAUDE.md 규칙(폴더 계층·스코핑 등) 재서술 금지 -->
```

- [ ] **Step 2: `~/.claude/settings.json`에 `env.SELF_IMPROVE_DIR = "C:\\Users\\User\\Desktop\\IRIS\\_자기개선(Self-Improvement)"` 추가** (기존 내용 읽고 병합)
- [ ] **Step 3: user 전역 플러그인 설치** — `claude plugin --help`로 CLI 확인 후: 로컬 마켓플레이스 추가(`claude plugin marketplace add "<이 프로젝트 절대경로>"`) → `claude plugin install self-improve@self-improve`. CLI 미지원이면 사용자에게 `/plugin` 메뉴 절차 안내.
- [ ] **Step 4: 설치 검증** — 설치 결과 확인(`claude plugin list` 또는 설정 파일), MCP 서버 수동 기동 스모크(`SELF_IMPROVE_DIR` 지정 후 initialize 왕복).
- [ ] **Step 5: IRIS-구조지도.html 갱신** — `_자기개선(Self-Improvement)` 노드 추가(루트 직속).
- [ ] **Step 6: Commit** — 프로젝트 repo에 배포 관련 변경분(있다면) 커밋.

### Task 11: 최종 검증

- [ ] **Step 1: `npm test` 전 스위트 PASS 확인**
- [ ] **Step 2: 스펙 대조** — §2 부품 2개, §3 데이터 모델·도구 4개, §4 감지 지침, §5 처방 사다리·재발 감시, §6 텔레메트리 게이트, §7 로컬 배포 완료 여부 체크.
- [ ] **Step 3: 공개 준비 상태 기록** — 깃허브 공개는 2~4주 개밥먹기 + `.stack` 바인딩 후(스택 가드레일) 별도 진행임을 최종 보고에 명시.
