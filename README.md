# self-improve

**한국어: [README.ko.md](README.ko.md)**

A Claude Code plugin that turns your corrections into lasting improvements.

The moment you fix or redo Claude's output is the most valuable data about the gap between *what you wanted* and *what Claude produced*. Today that data evaporates when the conversation ends. self-improve captures those moments, finds recurring patterns, and prescribes recurrence-prevention fixes — CLAUDE.md rules, skills, scripts, or MCP tools.

## Install

```
/plugin marketplace add Feynman520/self-improve
/plugin install self-improve@self-improve
```

Requires Node.js >= 18. No npm install needed — the plugin has zero runtime dependencies.

## How it works

**Hybrid logging** — Claude detects and logs automatically (always-on instructions shipped with the MCP server), and you can log manually with `/self-improve-log`.

Claude watches for 4 moments:

1. You correct or redo a result ("no, not that", "do it again")
2. You declare a future rule ("from now on, always ...")
3. A tool/command fails and Claude works around it
4. The same manual work repeats yet again

Noise filter: brand-new requests and one-off taste tweaks are **not** logged. The bar is the *one-sentence test* — if no reusable lesson can be stated in one sentence, nothing is recorded. After each log, Claude prints one line (`📝 개선점 기록: "..." (category)`); tell it to undo and the record is deleted.

### Categories (fixed)

| Category | Meaning |
|---|---|
| 오해 | Misread your request |
| 지식 부족 | Missing user/environment-specific fact |
| 도구 실패 | Tool or command failure |
| 환경 문제 | Config / path / permission issue |
| 반복 비효율 | Repeated manual work (automation candidate) |

### MCP tools

| Tool | Purpose |
|---|---|
| `log` | Save a record; auto-links similar past records (`related`) — repetition is evidence of a pattern |
| `search` | Filter records by keyword / category / project / status |
| `stats` | Aggregate by category / project / month |
| `resolve` | Mark records fixed, with the applied prescription (bulk ids) |

### Skills

- `/self-improve-log` — log an improvement point from the current conversation right now.
- `/self-improve-report` — periodic report: groups open records into patterns, then climbs the **prescription ladder** (CLAUDE.md rule → skill → script/library → MCP; always the lightest fix that works), sorted by impact-per-cost. Warns at the top when a resolved problem re-occurred (⚠️ prescription failed). Saved to `reports/YYYY-MM-DD-보고.md`.

**Recommended cadence:** run `/self-improve-report` after ~10 records or every 2–4 weeks.

## Storage

One record = one markdown file (frontmatter + 4 sections), fully local.

- Default: `.self-improve/` in the current project (`records/`, `reports/`)
- Override: set the `SELF_IMPROVE_DIR` environment variable to a central folder

```markdown
---
id: 2026-07-07-001
date: 2026-07-07
project: C:\path\to\project
category: 오해
status: open
related:
resolution:
---

## 무슨 일이 있었나
## 사용자가 진짜 원한 것
## 교훈
## 해결책 후보
```

## Telemetry

The plugin sends a small anonymous event to the developer's Google Sheet (via Google Apps Script) to improve the plugin. **Default: on** (users of this plugin — course participants — are informed in advance).

**Exactly what is sent, nothing more:**

- event type (`log` / `resolve`), category, an **anonymized** one-sentence lesson (Claude strips all names, paths, emails, file contents before sending), prescription type, plugin version, conversation language, timestamp.

Your record files, project paths, file contents, and identity are **never** sent.

**Turn it off** with one environment variable:

```
SELF_IMPROVE_TELEMETRY=off
```

If the endpoint URL is not configured in the source (`server/lib/telemetry.js`), telemetry is a complete no-op.

## Roadmap (v2 candidates)

- Praise (success-pattern) logging
- Telemetry dashboard
- Submission validation for the telemetry endpoint
- Optional hook-based detection

## License

MIT
