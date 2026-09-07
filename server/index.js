#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseDir } from './lib/store.js';
import {
  CATEGORIES, STATUSES, logRecord, searchRecords, statsRecords, resolveRecords,
  applyRule, registerArtifact, revokeArtifact, feedbackArtifact, pendingWork, dismissRecord,
} from './lib/tools.js';
import { MCP_INSTRUCTIONS } from './lib/instructions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;

const str = (description) => ({ type: 'string', description });
const TOOLS = [
  {
    name: 'log',
    description: 'Save a self-improvement record (a moment the result missed what the user wanted). Returns `ripe` when the same lesson has now recurred enough times to auto-apply a rule, and `recurrence_of_resolved` when a previously fixed lesson came back.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: CATEGORIES, description: '오해=misread request, 지식 부족=missing user/env fact, 도구 실패=tool failure, 환경 문제=config/path/permission issue, 반복 비효율=repeated manual work' },
        lesson: str('REQUIRED. One generalized sentence reusable next time.'),
        what_happened: str('What happened (facts).'),
        user_wanted: str('What the user really wanted.'),
        solution_candidates: str('Candidate fixes (rule / skill / script / MCP).'),
        project: str('Absolute path of the project folder where this happened (cwd).'),
        agent: str('Which agent: claude | codex | other.'),
        session: str('Session id if known (agent:id).'),
        candidate_id: str('If this record comes from a mined candidate returned by `pending`, its id (consumes the candidate).'),
      },
      required: ['category', 'lesson'],
    },
  },
  {
    name: 'pending',
    description: 'Call once at session start. Returns ripe clusters (apply_rule), escalations (fixed lessons that recurred), mined candidates (log or dismiss), and retire suggestions. Process AFTER finishing the user\'s current request.',
    inputSchema: { type: 'object', properties: { project: str('Current working folder, to prioritise candidates from this project.') } },
  },
  {
    name: 'apply_rule',
    description: 'Auto-apply a recurrence-prevention rule: writes one line into the managed block of the narrowest AGENTS.md/CLAUDE.md covering the records, registers it, and resolves the records. Call only after confirming the records share the same lesson.',
    inputSchema: {
      type: 'object',
      properties: {
        record_ids: { type: 'array', items: { type: 'string' }, description: 'Records that share this lesson (the ripe cluster).' },
        rule_text: str('One imperative sentence the agent must follow next time (10–300 chars).'),
        level: str('Optional folder path to place the rule in. Default: narrowest common ancestor with an instruction file.'),
      },
      required: ['record_ids', 'rule_text'],
    },
  },
  {
    name: 'register_artifact',
    description: 'Register a skill (<storage>/skills/<name>/SKILL.md, synced to every agent) or a guarded script (<storage>/scripts/<name>) you just created for a repeated lesson; resolves the records.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['skill', 'script'] },
        name: str('Skill folder name or script file name (with extension).'),
        record_ids: { type: 'array', items: { type: 'string' } },
        description: str('One sentence: what it does / which lesson it encodes.'),
      },
      required: ['type', 'name'],
    },
  },
  {
    name: 'feedback',
    description: 'Report how an auto artifact performed: success (worked as intended) or correction (user pointed out a problem; fix the artifact too). Scripts get trusted after repeated successes; artifacts retire after repeated corrections without success.',
    inputSchema: {
      type: 'object',
      properties: { artifact_id: str('A-nnn, R-nnn, or artifact name.'), outcome: { type: 'string', enum: ['success', 'correction'] }, note: str('Short note.') },
      required: ['artifact_id', 'outcome'],
    },
  },
  {
    name: 'revoke',
    description: 'Undo an auto artifact on user request ("규칙 R-003 빼", "그 스킬 빼"): removes the rule line / skill / script, retires it, and marks its records rejected so it will not be re-applied.',
    inputSchema: { type: 'object', properties: { id: str('A-nnn, R-nnn, or name.'), query: str('Text to match against rule text or name when the id is unknown.') } },
  },
  {
    name: 'dismiss',
    description: 'Discard a mined candidate that is not a reusable lesson.',
    inputSchema: { type: 'object', properties: { candidate_id: str('C-xxxxxxxx') }, required: ['candidate_id'] },
  },
  {
    name: 'search',
    description: 'Search self-improvement records by keyword/category/project/status.',
    inputSchema: { type: 'object', properties: { keyword: str(''), category: { type: 'string', enum: CATEGORIES }, project: str('Substring match on project path.'), status: { type: 'string', enum: STATUSES } } },
  },
  {
    name: 'stats',
    description: 'Aggregate records (category/month/project), recurrence rate, artifact counts, pending candidates.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'resolve',
    description: 'Mark records resolved by a fix you applied manually. If artifact_id refers to a rule, the server verifies the rule line really exists in its file.',
    inputSchema: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' } }, resolution: str('The fix that was applied.'), artifact_id: str('Optional artifact this fix corresponds to.') },
      required: ['ids', 'resolution'],
    },
  },
];

function callTool({ name, arguments: args = {} }) {
  const base = baseDir();
  switch (name) {
    case 'log': return logRecord(base, args);
    case 'pending': return pendingWork(base, args);
    case 'apply_rule': return applyRule(base, args);
    case 'register_artifact': return registerArtifact(base, args);
    case 'feedback': return feedbackArtifact(base, args);
    case 'revoke': return revokeArtifact(base, args);
    case 'dismiss': return dismissRecord(base, args);
    case 'search': return searchRecords(base, args);
    case 'stats': return statsRecords(base);
    case 'resolve': return resolveRecords(base, args);
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
        instructions: MCP_INSTRUCTIONS,
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
