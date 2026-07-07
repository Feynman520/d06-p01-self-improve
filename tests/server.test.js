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

    const unknown = await rpc(proc, { jsonrpc: '2.0', id: 6, method: 'no/such' });
    assert.equal(unknown.error.code, -32601);
  } finally {
    proc.kill();
  }
});
