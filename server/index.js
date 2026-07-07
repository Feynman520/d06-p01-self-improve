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
        category: { type: 'string', enum: CATEGORIES, description: '오해=misread request, 지식 부족=missing user/env fact, 도구 실패=tool failure, 환경 문제=config/path/permission issue, 반복 비효율=repeated manual work (automation candidate)' },
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
