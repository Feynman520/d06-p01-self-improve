// self-improve script guard (Node). Generated scripts import this and branch on `apply`.
//   import { guard } from './_guard.mjs';
//   const g = guard(import.meta.url);
//   if (!g.apply) console.log('[미리보기] would write X');   // dry-run until trusted
// Rules: dry-run by default; `--apply` forces a real run; a `<script>.trusted` marker
// (written by the plugin after repeated successes) makes real runs the default; `--dry-run` always wins.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function guard(metaUrl, argv = process.argv.slice(2)) {
  const self = fileURLToPath(metaUrl);
  const trusted = fs.existsSync(`${self}.trusted`);
  const dry = argv.includes('--dry-run');
  const forced = argv.includes('--apply');
  const apply = !dry && (forced || trusted);
  const args = argv.filter((a) => a !== '--dry-run' && a !== '--apply');
  if (!apply) console.error(`[self-improve] 미리보기 모드 (${trusted ? '--dry-run 지정' : '아직 신뢰 승격 전 — 실제 실행은 --apply'})`);
  return { apply, trusted, args };
}
