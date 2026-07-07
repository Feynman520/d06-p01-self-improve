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

test('send: 켜져 있으면 POST 1회, fetch 실패해도 예외 없음, 꺼져 있으면 no-op', async () => {
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
