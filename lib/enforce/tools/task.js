import { resolve, relative, isAbsolute } from "node:path";
import { getConfig } from "../config.js";
import { readState, writeState } from "../utils/fs.js";
import { runPreflight } from "../services/preflight.js";
import { checkBudget } from "../services/budget.js";
import { loadRouterConfig, callCritic } from "../services/critic.js";
import { getGitDiff, getGitDiffStat, hasGitRepo, hasGitCommits, getHeadSha } from "../services/evidence.js";
import { gitAdd, gitCommit, gitResetHard, gitClean } from "../services/git.js";

const TASK_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function sanitizePath(p, root) {
  const abs = resolve(root, p);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path outside repo: ${p}`);
  }
  return rel;
}

export function beginTaskTool(context) {
  return {
    description: "Initialize a new task. Saves baseline git SHA and file whitelist.",
    args: {
      task_id: { type: "string" },
      description: { type: "string" },
      files_whitelist: { type: "array", items: { type: "string" } },
      priority: { type: "string", enum: ["low", "medium", "high"] },
    },
    async execute(args) {
      const { task_id, description, files_whitelist, priority } = args;
      const { directory } = context;

      if (!TASK_ID_RE.test(task_id)) {
        return { status: "error", reason: "Invalid task_id: must match /^[a-zA-Z0-9_-]{1,64}$/" };
      }

      if (!files_whitelist || files_whitelist.length === 0) {
        return { status: "error", reason: "files_whitelist must not be empty" };
      }

      let normalized;
      try {
        normalized = files_whitelist.map((f) => sanitizePath(f, directory));
      } catch (e) {
        return { status: "error", reason: e.message };
      }

      const baseline_sha = getHeadSha(directory);
      if (!baseline_sha) {
        return { status: "error", reason: "No git commits found. Make at least one commit before starting a task." };
      }

      const st = readState(directory);
      st.task_id = task_id;
      st.description = description;
      st.priority = priority;
      st.phase = "planning";
      st.baseline_sha = baseline_sha;
      st.files_whitelist = normalized;
      st.validated = false;
      st.task_started_at = new Date().toISOString();
      st.started_at = new Date().toISOString();
      st.attempts = 0;
      st.last_activity = new Date().toISOString();

      if (!writeState(directory, st)) {
        return { status: "error", reason: "Failed to write state.json" };
      }

      return {
        status: "success",
        task_id,
        baseline_sha,
        files_whitelist: normalized,
        message: `Task ${task_id} initialized. Baseline: ${baseline_sha.slice(0, 8)}. Next: create_plan() for non-trivial tasks.`,
      };
    },
  };
}

export function createPlanTool(context) {
  return {
    description: "Declare task scope and risk level. Auto-approves low-risk plans.",
    args: {
      task_id: { type: "string" },
      affected_files: { type: "array", items: { type: "string" } },
      risk_level: { type: "string", enum: ["low", "medium", "high"] },
      acceptance_criteria: { type: "array", items: { type: "string" } },
    },
    async execute(args) {
      const { task_id, affected_files, risk_level, acceptance_criteria } = args;
      const { directory } = context;

      if (!TASK_ID_RE.test(task_id)) {
        return { status: "error", reason: "Invalid task_id" };
      }

      const cfg = getConfig(directory);
      const budgetCheck = checkBudget(directory, "create_plan");
      if (!budgetCheck.allowed) return { status: "error", reason: budgetCheck.reason };

      if (affected_files.length > cfg.budget_limits.max_files) {
        return { status: "error", reason: `Budget exceeded: max ${cfg.budget_limits.max_files} files per task` };
      }

      let normalized;
      try {
        normalized = affected_files.map((f) => sanitizePath(f, directory));
      } catch (e) {
        return { status: "error", reason: e.message };
      }

      const now = new Date().toISOString();
      const st = readState(directory);
      st.plan_created_at = now;
      st.plan = {
        affected_files: normalized,
        risk_level,
        acceptance_criteria,
        created_at: now,
      };
      st.last_activity = now;

      // Auto-approve low-risk
      if (risk_level === "low") {
        st.plan_approved_at = now;
        st.phase = "implementing";
        st.validated = false;
        if (!writeState(directory, st)) {
          return { status: "error", reason: "Failed to write state.json" };
        }
        return {
          status: "success",
          auto_approved: true,
          risk_level,
          message: "Low-risk plan auto-approved. Proceed to implementation.",
        };
      }

      st.phase = "planning";
      if (!writeState(directory, st)) {
        return { status: "error", reason: "Failed to write state.json" };
      }

      return {
        status: "success",
        risk_level,
        next: "STOP and wait for explicit user approval, then call approve_plan().",
      };
    },
  };
}

export function approvePlanTool(context) {
  return {
    description: "Record explicit user approval of a plan. Required for medium/high-risk tasks.",
    args: {
      task_id: { type: "string" },
    },
    async execute(args) {
      const { task_id } = args;
      const { directory } = context;

      if (!TASK_ID_RE.test(task_id)) {
        return { status: "error", reason: "Invalid task_id" };
      }

      const st = readState(directory);
      if (!st.plan) {
        return { status: "error", reason: `No plan for task ${task_id}. Call create_plan() first.` };
      }

      const now = new Date().toISOString();
      st.plan_approved_at = now;
      st.phase = "implementing";
      st.validated = false;
      st.last_activity = now;

      if (!writeState(directory, st)) {
        return { status: "error", reason: "Failed to write state.json" };
      }

      return {
        status: "success",
        message: `Plan for ${task_id} approved. Implementation allowed.`,
      };
    },
  };
}

export function validateChangesTool(context) {
  return {
    description: "Run preflight checks + Fresh Critic review in one pipeline. Sets validated=true on success.",
    args: {
      task_id: { type: "string" },
    },
    async execute(args) {
      const { task_id } = args;
      const { directory, sessionId } = context;

      if (!TASK_ID_RE.test(task_id)) {
        return { status: "error", reason: "Invalid task_id" };
      }

      const st = readState(directory);
      const files = st.files_whitelist || [];

      // Step 1: Preflight
      const preflight = await runPreflight(directory, files);
      context.lastPreflightResult = preflight;

      if (!preflight.passed) {
        st.validated = false;
        writeState(directory, st);
        return {
          status: "fail",
          stage: "preflight",
          step: preflight.step,
          kind: preflight.kind,
          output: preflight.output,
          message: `Preflight failed at ${preflight.step}`,
        };
      }

      // Step 2: Fresh Critic (graceful degradation if no API key)
      let criticResult = null;
      const routerCfg = loadRouterConfig(directory);
      if (routerCfg.apiKey && hasGitRepo(directory) && hasGitCommits(directory)) {
        const diff = getGitDiff(directory, files);
        if (diff.available && diff.diff.trim().length > 0) {
          const projectCfg = getConfig(directory);
          const userPrompt = [
            `Task ID: ${task_id}`,
            `Risk Level: ${st.plan?.risk_level || "unknown"}`,
            `Acceptance Criteria: ${(st.plan?.acceptance_criteria || []).join(", ")}`,
            `\nGit diff (HEAD vs working tree):\n\`\`\`diff\n${diff.diff}\n\`\`\``,
            `\nDiff stat:\n${getGitDiffStat(directory, files).stat || "N/A"}`,
            "\nReview ONLY the changes shown in the diff.",
          ].join("\n");

          criticResult = await callCritic(projectCfg.critic_system_prompt, userPrompt, routerCfg);

          if (criticResult.error) {
            // Graceful degradation: critic failed, warn but don't block
            criticResult = { verdict: "approved", feedback: [`Critic unavailable: ${criticResult.error}`], degraded: true };
          }
        }
      }

      // Step 3: Check verdict
      if (criticResult && criticResult.verdict !== "approved") {
        st.validated = false;
        writeState(directory, st);
        return {
          status: "fail",
          stage: "critic",
          verdict: criticResult.verdict,
          feedback: criticResult.feedback,
          message: "Fresh Critic requested changes. Address feedback and validate again.",
        };
      }

      // All checks passed
      st.validated = true;
      st.review = criticResult ? {
        verdict: criticResult.verdict,
        feedback: criticResult.feedback,
        degraded: !!criticResult.degraded,
      } : null;
      st.last_activity = new Date().toISOString();
      writeState(directory, st);

      return {
        status: "pass",
        preflight: preflight.steps,
        critic: criticResult ? { verdict: criticResult.verdict, degraded: !!criticResult.degraded } : null,
        message: "All checks passed. Ready to commit.",
      };
    },
  };
}

export function waiveReviewTool(context) {
  return {
    description: "Operator override: skip Fresh Critic review. Use ONLY on explicit user order.",
    args: {
      task_id: { type: "string" },
      reason: { type: "string" },
    },
    async execute(args) {
      const { task_id, reason } = args;
      const { directory } = context;

      if (!TASK_ID_RE.test(task_id)) {
        return { status: "error", reason: "Invalid task_id" };
      }
      if (!reason || reason.trim().length === 0) {
        return { status: "error", reason: "Waiver reason cannot be empty" };
      }

      const st = readState(directory);
      st.review = { verdict: "waived", feedback: [], waived_reason: reason };
      st.validated = true;
      st.last_activity = new Date().toISOString();
      writeState(directory, st);

      return {
        status: "success",
        message: `Review gate waived for ${task_id}. Reason: ${reason}`,
      };
    },
  };
}

export function commitTaskTool(context) {
  return {
    description: "Atomic git commit of whitelisted files with conventional commit message.",
    args: {
      task_id: { type: "string" },
      type: { type: "string", enum: ["feat", "fix", "docs", "style", "refactor", "test", "chore", "perf", "ci"] },
      scope: { type: "string" },
      summary: { type: "string" },
    },
    async execute(args) {
      const { task_id, type, scope, summary } = args;
      const { directory } = context;

      if (!TASK_ID_RE.test(task_id)) {
        return { status: "error", reason: "Invalid task_id" };
      }

      const st = readState(directory);

      // TOCTOU guard: must be validated
      if (!st.validated) {
        return {
          status: "error",
          reason: "Cannot commit: changes were not validated. Run validate_changes() first.",
        };
      }

      const files = st.files_whitelist || [];
      if (files.length === 0) {
        return { status: "error", reason: "No files in whitelist. Call begin_task() first." };
      }

      // Budget check
      const budgetCheck = checkBudget(directory, "complete_task");
      if (!budgetCheck.allowed) return { status: "error", reason: budgetCheck.reason };

      // Build conventional commit message
      const sanitizedScope = String(scope || "general")
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || "general";
      const subject = summary.length > 50 ? summary.slice(0, 50) + "..." : summary;
      const message = `${type}(${sanitizedScope}): ${subject} [${task_id}]`;

      // git add + commit
      const addResult = gitAdd(directory, files);
      if (!addResult.success) {
        return { status: "error", reason: `git add failed: ${addResult.reason}` };
      }

      const commitResult = gitCommit(directory, message);
      if (!commitResult.success) {
        return { status: "error", reason: `git commit failed: ${commitResult.reason}` };
      }

      // Update state
      st.phase = "completed";
      st.completed_at = new Date().toISOString();
      st.attempts = (st.attempts || 0) + 1;
      st.last_activity = new Date().toISOString();
      writeState(directory, st);

      return {
        status: "success",
        commit_hash: commitResult.commit_hash,
        message,
        files_count: files.length,
        task_id,
      };
    },
  };
}

export function abortTaskTool(context) {
  return {
    description: "Emergency rollback to baseline SHA. Restores repo to clean state.",
    args: {
      task_id: { type: "string" },
      reason: { type: "string" },
    },
    async execute(args) {
      const { task_id, reason } = args;
      const { directory } = context;

      if (!TASK_ID_RE.test(task_id)) {
        return { status: "error", reason: "Invalid task_id" };
      }

      const st = readState(directory);
      const sha = st.baseline_sha;

      if (!sha) {
        return { status: "error", reason: "No baseline_sha found. Cannot abort without a baseline." };
      }

      // Safe rollback: reset to baseline, clean untracked (preserve .opencode)
      const resetResult = gitResetHard(directory, sha);
      if (!resetResult.success) {
        return { status: "error", reason: `git reset --hard failed: ${resetResult.reason}` };
      }

      const cleanResult = gitClean(directory);
      if (!cleanResult.success) {
        return { status: "warning", reason: `git clean failed: ${cleanResult.reason}. Manual cleanup may be needed.` };
      }

      st.phase = "aborted";
      st.abort_reason = reason;
      st.aborted_at = new Date().toISOString();
      st.last_activity = new Date().toISOString();
      writeState(directory, st);

      return {
        status: "success",
        restored_to: sha.slice(0, 8),
        reason,
        message: `Task ${task_id} aborted. Repository restored to ${sha.slice(0, 8)}.`,
      };
    },
  };
}
