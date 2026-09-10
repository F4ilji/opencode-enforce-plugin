# Enforce-Lite Plugin for OpenCode

Git-first governance plugin for opencode. Enforces scope, validates changes, and commits atomically.

## Installation

```bash
cd /path/to/project
make -f /path/to/enforce-plugin/Makefile install
```

## What gets installed

- `.opencode/plugins/enforce.js` — entry point
- `.opencode/lib/enforce/` — core library
- `.opencode/package.json` — dependencies
- `.opencode/config.json` — configuration (if not exists)
- `AGENTS.md` — agent protocol (if not exists)

## Configuration

Edit `.opencode/config.json` for your project:

- `preflight.compileall_cmd` — compile/syntax check command
- `preflight.linter_cmd` — linter command (use `{file}` placeholder)
- `preflight.test_cmd` — test command
- `preflight.timeouts` — timeout per step in ms
- `budget_limits` — max attempts, minutes, files per task
- `control_plane_files` — regex patterns for protected files
- `critic_system_prompt` — Fresh Critic system prompt

Example for Docker-based projects:
```json
{
  "preflight": {
    "test_cmd": "docker compose exec -T app pytest",
    "linter_cmd": "docker compose exec -T app ruff check {file}"
  }
}
```

## Tools (7 total)

- `begin_task(task_id, description, files_whitelist, priority)` — initialize task + baseline SHA
- `create_plan(task_id, affected_files, risk_level, acceptance_criteria)` — declare scope
- `approve_plan(task_id)` — human approval gate
- `validate_changes(task_id)` — preflight + Fresh Critic review
- `waive_review(task_id, reason)` — operator override
- `commit_task(task_id, type, scope, summary)` — atomic git commit
- `abort_task(task_id, reason)` — emergency rollback to baseline

## Uninstall

```bash
make -f /path/to/enforce-plugin/Makefile uninstall
```
