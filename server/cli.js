#!/usr/bin/env node
// self-improve CLI (agent-neutral): install | mine | nightly | backfill | status
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { baseDir, ensureDirs, loadConfig, saveConfig, getRecord, listRecords } from './lib/store.js';
import { ensureInstructionFile, normalizePath } from './lib/paths.js';
import { ensureBlock } from './lib/managed.js';
import { installGuards } from './lib/skills.js';
import { mine, linkSessions } from './lib/mine.js';
import { INSTRUCTIONS } from './lib/instructions.js';
import { statsRecords, ripeClusters, applyRule } from './lib/tools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, 'index.js');
const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };
const base = baseDir();
const out = (s) => process.stdout.write(s + '\n');

function installCodex(cfg) {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  if (!fs.existsSync(codexHome)) return `codex: ${codexHome} 없음 — 건너뜀`;
  const file = path.join(codexHome, 'config.toml');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (/\[mcp_servers\.self-improve\]/.test(text)) return `codex: 이미 등록됨 (${file})`;
  const toml = (s) => JSON.stringify(s);
  const block = [
    '', '[mcp_servers.self-improve]', 'command = "node"', `args = [${toml(SERVER)}]`,
    '', '[mcp_servers.self-improve.env]', `SELF_IMPROVE_DIR = ${toml(base)}`, '',
  ].join('\n');
  fs.writeFileSync(file, (text && !text.endsWith('\n') ? text + '\n' : text) + block, 'utf8');
  return `codex: 등록 완료 (${file})`;
}

function installSchedule() {
  if (process.platform === 'win32') {
    const tr = `"${process.execPath}" "${path.join(__dirname, 'cli.js')}" nightly`;
    const r = spawnSync('schtasks', ['/Create', '/F', '/SC', 'DAILY', '/ST', '03:30', '/TN', 'self-improve nightly', '/TR', tr], { encoding: 'utf8', env: { ...process.env } });
    return r.status === 0 ? 'schedule: Windows 작업 스케줄러 "self-improve nightly" 매일 03:30 등록' : `schedule: 등록 실패 — ${r.stderr || r.stdout}`;
  }
  return `schedule: crontab에 추가하세요 →  30 3 * * * SELF_IMPROVE_DIR=${base} ${process.execPath} ${path.join(__dirname, 'cli.js')} nightly`;
}

async function main() {
  switch (cmd) {
    case 'install': {
      ensureDirs(base);
      const cfg = loadConfig(base);
      const root = opt('root', cfg.root);
      if (root) cfg.root = normalizePath(root);
      saveConfig(base, cfg);
      out(`storage: ${base}`);
      out(`guards: ${installGuards(base, path.join(__dirname, 'assets')).join(', ')}`);
      if (cfg.root) {
        const file = ensureInstructionFile(cfg.root);
        ensureBlock(file, { instructions: INSTRUCTIONS });
        out(`root block: ${file} (지시문 + 자동 규칙 구역)`);
      } else out('root: 미설정 — --root <workspace> 로 지정하면 루트 AGENTS.md에 지시문 구역을 넣습니다');
      if (flag('codex')) out(installCodex(cfg));
      out('claude: /plugin marketplace add Feynman520/d06-p01-self-improve → /plugin install self-improve@self-improve (env SELF_IMPROVE_DIR 을 설정에 추가)');
      if (flag('schedule')) out(installSchedule());
      break;
    }
    case 'mine':
    case 'nightly': {
      ensureDirs(base);
      const cfg = loadConfig(base);
      const lines = [];
      const s = await mine(base, cfg, { days: Number(opt('days', cfg.mine_days)), log: (m) => lines.push(m) });
      const linked = linkSessions(base, cfg.path_aliases);
      const summary = { ...s, records_linked: linked, ts: new Date().toISOString() };
      out(JSON.stringify(summary));
      if (cmd === 'nightly') {
        const logDir = path.join(base, 'logs');
        fs.mkdirSync(logDir, { recursive: true });
        fs.appendFileSync(path.join(logDir, `nightly-${summary.ts.slice(0, 7)}.log`), JSON.stringify(summary) + (lines.length ? '\n' + lines.join('\n') : '') + '\n', 'utf8');
      }
      break;
    }
    case 'backfill': {
      const cfg = loadConfig(base);
      const clusters = ripeClusters(base, cfg);
      const md = ['# 자기개선 초회 일괄 처리 제안', '', `생성: ${new Date().toISOString()} · 익은 패턴 ${clusters.length}개`, ''];
      const results = [];
      for (const c of clusters) {
        const lessons = c.ids.map((id) => getRecord(base, id)).filter(Boolean).map((r) => r.sections.lesson);
        const rule = lessons.slice().sort((a, b) => a.length - b.length)[0];
        md.push(`## ${c.category} · ${c.ids.length}건 → ${c.suggested_level || '(레벨 미정)'}`, '', `- 규칙안: ${rule}`, `- 기록: ${c.ids.join(', ')}`,
          c.existing_artifact ? `- ⚠ 이미 산출물 있음: ${c.existing_artifact.id}` : '', '');
        if (flag('apply') && !c.existing_artifact && c.suggested_level) {
          try { results.push(applyRule(base, { record_ids: c.ids, rule_text: rule.slice(0, 300), level: c.suggested_level })); }
          catch (e) { results.push({ error: e.message, ids: c.ids }); }
        }
      }
      const file = path.join(base, `backfill-${new Date().toISOString().slice(0, 10)}.md`);
      fs.writeFileSync(file, md.join('\n') + '\n', 'utf8');
      out(`proposal: ${file}`);
      if (flag('apply')) out(JSON.stringify(results, null, 2));
      else out(`dry-run — 적용하려면 --apply (익은 패턴 ${clusters.length}개, 열린 기록 ${listRecords(base).filter((r) => r.status === 'open').length}건)`);
      break;
    }
    case 'status':
      out(JSON.stringify(statsRecords(base), null, 2));
      break;
    default:
      out('usage: node server/cli.js <install [--root DIR] [--codex] [--schedule] | mine [--days N] | nightly | backfill [--apply] | status>');
      process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
