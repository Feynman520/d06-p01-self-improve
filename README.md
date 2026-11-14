# self-improve

**한국어: [README.ko.md](README.ko.md)**

An agent-neutral self-improvement loop for coding agents (Claude Code, Codex). The more you work with the agent, the more it adapts to you: the moments you correct it are captured, and when the same lesson recurs the fix is **applied automatically** — a rule in your instruction file, a skill, or a guarded script — with a one-line notice and a one-phrase undo.

Everything stays on your machine. There is no telemetry.

## What it does

```text
① capture   — the agent logs a correction moment (or a nightly miner finds one in session transcripts)
      ↓
② detect    — the server notices the same lesson has recurred (2nd time; 3rd for taste/misread lessons)
      ↓
③ apply     — a rule line is written into a managed block of the narrowest AGENTS.md/CLAUDE.md that covers the affected projects
      ↓
④ grow      — procedural lessons become skills (synced to every agent), repeated manual work becomes a guarded script
      ↓
⑤ learn     — every use reports success/correction; scripts earn trust, bad artifacts retire, "R-003 빼" reverts anything
```

| Piece | How |
|---|---|
| Records | one markdown file per lesson, `SELF_IMPROVE_DIR/records/` (default `.self-improve/` in cwd) |
| Ripeness | token-overlap similarity tuned on real Korean/English lessons; the model confirms before applying |
| Rules | written only inside `<!-- self-improve:begin … end -->` in AGENTS.md (or CLAUDE.md); human text untouched; per-file cap; file lock |
| Level | narrowest common ancestor folder that already has an instruction file, never above `root` |
| Skills | authored centrally in `SELF_IMPROVE_DIR/skills/<name>/SKILL.md`, copied to each agent's skills dir as `si-<name>` |
| Scripts | `SELF_IMPROVE_DIR/scripts/`, must use `_guard.mjs` / `_guard.py`: preview by default, `--apply` to run, auto-trusted after 3 successes |
| Registry | `registry.json` maps every artifact ↔ records ↔ version ↔ trust; fixes go to the existing artifact instead of a duplicate |
| Mining | `cli.js nightly` scans Claude (`projects/*.jsonl`) and Codex (`sessions/**/rollout-*.jsonl`) transcripts for user corrections, tool errors and repeated tool loops → candidate queue |
| Never automated | secrets, permissions, deploys, deletes, billing — the instructions forbid putting these in auto artifacts |

## MCP tools

| Tool | Purpose |
|---|---|
| `log` | save a record; returns `ripe` (recurrence reached) and `recurrence_of_resolved` (a fixed lesson came back) |
| `pending` | call at session start: ripe clusters, escalations, mined candidates (≤3), retire suggestions |
| `apply_rule` | write a rule into the managed block, register it, resolve the records |
| `register_artifact` | register a skill (synced to agents) or a guarded script |
| `feedback` | `success` / `correction` for an artifact → trust, promotion, retirement |
| `revoke` | undo an artifact; its records become `rejected` so it is never re-applied |
| `dismiss` | drop a mined candidate |
| `search` / `stats` / `resolve` | query records, recurrence rate, artifact counts; manual resolve (rule existence is verified) |

## Install

```
git clone https://github.com/Feynman520/d06-p01-self-improve
cd d06-p01-self-improve
set SELF_IMPROVE_DIR=C:\path\to\central\store      # optional but recommended (one store for all projects)
node server/cli.js install --root C:\path\to\workspace --codex --schedule
```

- `--root` writes the agent instructions into the root `AGENTS.md` managed block (creates `AGENTS.md` + `CLAUDE.md` shell if missing) so **every agent reads the same instructions**.
- `--codex` registers the MCP server in `$CODEX_HOME/config.toml`.
- `--schedule` registers the nightly transcript miner (Windows Task Scheduler; prints a crontab line elsewhere).
- Claude Code: `/plugin marketplace add Feynman520/d06-p01-self-improve` → `/plugin install self-improve@self-improve`, and add `SELF_IMPROVE_DIR` to the plugin env.

Requires Node.js ≥ 18. Zero runtime dependencies.

## CLI

```
node server/cli.js install [--root DIR] [--codex] [--schedule]
node server/cli.js mine [--days N]      # scan transcripts now
node server/cli.js nightly              # mine + link sessions + log to <store>/logs
node server/cli.js backfill [--apply]   # first-run: cluster existing open records → proposal (dry-run by default)
node server/cli.js status
```

## Config (`SELF_IMPROVE_DIR/config.json`)

```json
{
  "root": "C:\\workspace",
  "path_aliases": { "C:\\old\\workspace": "C:\\workspace" },
  "rule_cap": 30,
  "ripe_threshold": { "default": 2, "오해": 3 },
  "mine_days": 30,
  "candidates_per_session": 3,
  "retire_after_days": 60
}
```

## Undo

Say to the agent: `규칙 R-003 빼` / `remove rule R-003` / `그 스킬 빼`. The line, skill or script is removed, the artifact retired, and its records marked `rejected`.

## License

MIT

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute and [SECURITY.md](SECURITY.md) for reporting security issues.
