# Enforce-TDD V2 Plugin for OpenCode

Git-first TDD governance plugin for opencode. Enforces red-green-refactor cycle via deterministic FSM, hardware file guards, and native SQLite state.

## Key Properties

- **Zero external dependencies** — native `node:sqlite`, no npm packages beyond `@opencode-ai/plugin`
- **Zero network calls** — no external LLM critics, no API keys
- **Hardware TDD gate** — agent physically cannot edit implementation in RED or tests in GREEN
- **4 atomic tools** — minimal protocol surface

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
- `control_plane_files` — regex patterns for protected files

Example for Node.js projects:
```json
{
  "preflight": {
    "compileall_cmd": "tsc --noEmit",
    "linter_cmd": "eslint {file}",
    "test_cmd": "npm test"
  }
}
```

## FSM Lifecycle

```
IDLE ──task_start──► TDD_RED ──task_verify──► TDD_GREEN ──task_verify──► VALIDATED ──task_commit──► IDLE
                        ▲                          │
                        └──────────────────────────┘
                              task_rollback (any phase)
```

| Phase | Writes allowed | Exit condition |
|-------|---------------|----------------|
| `tdd_red` | `test_files` only | Tests fail with AssertionError |
| `tdd_green` | `files_whitelist` only | All tests pass (exit 0) |
| `validated` | none (read-only) | User approves commit |

## Tools (4 total)

- `task_start(task_id, files_whitelist, test_files, description)` — init task, lock baseline SHA, enter `tdd_red`
- `task_verify()` — run linter+tests; RED→GREEN or GREEN→validated
- `task_commit(type, scope, summary)` — atomic git commit (requires `validated`)
- `task_rollback(reason)` — hard reset to baseline SHA

## Guard Rules

Pre-execution guard intercepts `edit`/`write`/`apply_patch`:

- **No active task** → blocked
- **RED + impl file** → `TDD_RED_VIOLATION`
- **GREEN + test file** → `TEST_LOCK_VIOLATION`
- **GREEN + non-whitelist** → `SCOPE_CREEP`

## Storage

State persists in `.opencode/enforce.db` (SQLite via `node:sqlite`):

- `task_state` — singleton FSM state, whitelist, baseline SHA
- `test_runs` — audit log of verification attempts

## Testing

```bash
npm test
```

Runs 29 tests covering db, guard, reducer, and structure.

## Uninstall

```bash
make -f /path/to/enforce-plugin/Makefile uninstall
```
