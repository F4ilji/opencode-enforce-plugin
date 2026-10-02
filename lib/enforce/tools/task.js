import { resolve, relative, isAbsolute } from "node:path";
import { getState, upsertState, updatePhase, recordTestRun } from "../services/db.js";
import { runPreflight } from "../services/preflight.js";
import { hasGitRepo, getHeadSha } from "../services/evidence.js";
import { gitAdd, gitCommit, gitResetHard, gitClean } from "../services/git.js";

const TASK_ID_RE = /^[A-Z0-9_-]{1,32}$/;

function sanitizePath(p, root) {
  const abs = resolve(root, p);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path outside repo: ${p}`);
  }
  return rel;
}

function sanitizePaths(paths, root, field) {
  if (!paths || paths.length === 0) {
    throw new Error(`${field} must not be empty`);
  }
  return paths.map((f) => sanitizePath(f, root));
}

export function taskStartTool(context, db) {
  return {
    description: "Initialize TDD task. Locks baseline SHA, enters tdd_red. Writes allowed only in test_files.",
    args: {
      task_id: { type: "string" },
      files_whitelist: { type: "array", items: { type: "string" } },
      test_files: { type: "array", items: { type: "string" } },
      description: { type: "string" },
    },
    async execute(args) {
      const { task_id, files_whitelist, test_files, description } = args;
      const { directory } = context;

      if (!TASK_ID_RE.test(task_id)) {
        return { status: "error", reason: "Invalid task_id: must match /^[A-Z0-9_-]{1,32}$/" };
      }

      let implFiles, tests;
      try {
        implFiles = sanitizePaths(files_whitelist, directory, "files_whitelist");
        tests = sanitizePaths(test_files, directory, "test_files");
      } catch (e) {
        return { status: "error", reason: e.message };
      }

      if (!hasGitRepo(directory)) {
        return { status: "error", reason: "Not a git repository." };
      }
      const baseline_sha = getHeadSha(directory);
      if (!baseline_sha) {
        return { status: "error", reason: "No git commits found. Make at least one commit before starting a task." };
      }

      const existing = getState(db);
      if (existing && !["idle", "completed", "aborted"].includes(existing.phase)) {
        return { status: "error", reason: `Active task '${existing.task_id}' in phase '${existing.phase}'. Finish or rollback first.` };
      }

      const now = new Date().toISOString();
      upsertState(db, {
        task_id,
        current_session_id: context.sessionId ?? null,
        phase: "tdd_red",
        priority: "medium",
        baseline_sha,
        files_whitelist: implFiles,
        test_files: tests,
        validated: false,
        session_tokens: 0,
        created_at: now,
      });

      context.taskDescription = description;

      return {
        status: "success",
        task_id,
        phase: "tdd_red",
        baseline_sha,
        files_whitelist: implFiles,
        test_files: tests,
        message: `Task ${task_id} started. Phase: TDD_RED. Write failing tests in [${tests.join(", ")}], then call task_verify().`,
      };
    },
  };
}

export function taskVerifyTool(context, db) {
  return {
    description: "Run linter+tests. RED: expects AssertionError → tdd_green. GREEN: expects exit 0 → validated.",
    args: {},
    async execute() {
      const { directory } = context;
      const state = getState(db);

      if (!state || state.phase === "idle") {
        return { status: "error", reason: "No active task. Call task_start() first." };
      }
      if (!["tdd_red", "tdd_green"].includes(state.phase)) {
        return { status: "error", reason: `Cannot verify in phase '${state.phase}'.` };
      }

      const files = [...state.files_whitelist, ...state.test_files];
      const preflight = await runPreflight(directory, files);

      recordTestRun(db, {
        task_id: state.task_id,
        phase: state.phase,
        exit_code: preflight.passed ? 0 : 1,
        error_digest: preflight.passed ? null : preflight.output,
        raw_log_path: preflight.rawLogPath ?? null,
        duration_ms: preflight.duration_ms ?? 0,
      });

      if (state.phase === "tdd_red") {
        if (preflight.passed) {
          return {
            status: "fail",
            reason: "TDD violation: тесты зеленые без реализации. Напишите падающие тесты.",
            output: preflight.output,
          };
        }
        updatePhase(db, "tdd_green", { validated: false });
        return {
          status: "success",
          phase: "tdd_green",
          message: "RED confirmed. Tests locked on write. Implement code in files_whitelist, then call task_verify() again.",
          digest: preflight.output,
        };
      }

      if (!preflight.passed) {
        return {
          status: "fail",
          phase: "tdd_green",
          output: preflight.output,
          message: `Tests failed at ${preflight.step}. Fix implementation (not tests).`,
        };
      }

      updatePhase(db, "validated", { validated: true });
      return {
        status: "success",
        phase: "validated",
        message: "All checks green. Show diff to user. After approval call task_commit().",
      };
    },
  };
}

export function taskCommitTool(context, db) {
  return {
    description: "Atomic commit of whitelist+test_files. Hard-blocked unless phase=validated.",
    args: {
      type: { type: "string", enum: ["feat", "fix", "refactor", "test", "chore"] },
      scope: { type: "string" },
      summary: { type: "string" },
    },
    async execute(args) {
      const { type, scope, summary } = args;
      const { directory } = context;
      const state = getState(db);

      if (!state || state.phase !== "validated" || !state.validated) {
        return { status: "error", reason: "Cannot commit: phase must be 'validated'. Run task_verify() first." };
      }

      const files = [...state.files_whitelist, ...state.test_files];

      const sanitizedScope = String(scope || "general")
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || "general";
      const subject = summary.length > 50 ? summary.slice(0, 50) + "..." : summary;
      const message = `${type}(${sanitizedScope}): ${subject} [${state.task_id}]`;

      const addResult = gitAdd(directory, files);
      if (!addResult.success) {
        return { status: "error", reason: `git add failed: ${addResult.reason}` };
      }

      const commitResult = gitCommit(directory, message);
      if (!commitResult.success) {
        return { status: "error", reason: `git commit failed: ${commitResult.reason}` };
      }

      updatePhase(db, "idle", { validated: false });

      return {
        status: "success",
        commit_hash: commitResult.commit_hash,
        message,
        files_count: files.length,
        task_id: state.task_id,
      };
    },
  };
}

export function taskRollbackTool(context, db) {
  return {
    description: "Emergency rollback to baseline_sha. Resets FSM to idle.",
    args: {
      reason: { type: "string" },
    },
    async execute(args) {
      const { reason } = args;
      const { directory } = context;
      const state = getState(db);

      if (!state || !state.baseline_sha) {
        return { status: "error", reason: "No baseline_sha found. Cannot rollback without an active task." };
      }

      const resetResult = gitResetHard(directory, state.baseline_sha);
      if (!resetResult.success) {
        return { status: "error", reason: `git reset --hard failed: ${resetResult.reason}` };
      }

      const cleanResult = gitClean(directory);
      if (!cleanResult.success) {
        return { status: "warning", reason: `git clean failed: ${cleanResult.reason}. Manual cleanup may be needed.` };
      }

      updatePhase(db, "idle", { validated: false });

      return {
        status: "success",
        restored_to: state.baseline_sha.slice(0, 8),
        reason,
        message: `Task ${state.task_id} rolled back to ${state.baseline_sha.slice(0, 8)}.`,
      };
    },
  };
}
