import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { OPENC_DIR, getConfig, RISK_ORDER } from "../config.js";
import {
  ensureDir,
  readState,
  writeState,
  writeFileContent,
} from "../utils/fs.js";
import { logAudit, incrementMetric } from "../utils/audit.js";
import { diceCoefficient } from "../utils/strings.js";
import { runPreflight } from "../services/preflight.js";
import { checkBudget, detectOrderViolations } from "../services/budget.js";
import { readFactsJsonl } from "../services/memory.js";
import { regenerateMemoryMd } from "../services/migration.js";
import {
  gatherEvidence,
  getGitDiff,
  saveArtifact,
} from "../services/evidence.js";
import { gitAdd, gitCommit, gitAddAndCommit } from "../services/git.js";

export function createTaskTool(context) {
  return {
    description:
      "Create a new task in pending queue. Deduplicates against existing open tasks.",
    args: {
      task_id: { type: "string" },
      description: { type: "string" },
      priority: { type: "string", enum: ["low", "medium", "high"] },
      acceptance_criteria: { type: "array", items: { type: "string" } },
    },
    async execute(args) {
      const { task_id, description, priority, acceptance_criteria } = args;
      const { directory, sessionId } = context;
      const pendingOpenDir = join(directory, OPENC_DIR, "pending/open");
      ensureDir(pendingOpenDir);

      try {
        const existing = readdirSync(pendingOpenDir).filter((f) =>
          f.endsWith(".json"),
        );
        for (const file of existing) {
          try {
            const card = JSON.parse(
              readFileSync(join(pendingOpenDir, file), "utf8"),
            );
            const sameId = card.task_id === task_id;
            const sameDesc =
              diceCoefficient(card.description || "", description) > 0.85;
            if (sameId || sameDesc) {
              return {
                status: "exists",
                task_id: card.task_id,
                task_path: `.opencode/pending/open/${file}`,
                message: `Similar task already open: ${card.task_id}. Use it instead of creating a new one.`,
              };
            }
          } catch (e) {
            /* ignore malformed */
          }
        }
      } catch (e) {
        /* ignore */
      }

      const task = {
        task_id,
        description,
        priority,
        acceptance_criteria,
        created_at: new Date().toISOString(),
      };
      // v11.4: critical write — never claim success on failure
      const taskWritten = writeFileContent(
        join(pendingOpenDir, `${task_id}.json`),
        JSON.stringify(task, null, 2),
      );
      if (!taskWritten) {
        logAudit(directory, { event: "task_card_write_failed", task_id });
        return {
          status: "error",
          reason: `Failed to write task card .opencode/pending/open/${task_id}.json (disk full or permissions). Task NOT created.`,
        };
      }

      const st = readState(directory);
      st.task_id = task_id;
      st.task_started_at = new Date().toISOString();
      st.attempts = 0;
      st.task_files = [];
      st.phase = "pending";
      st.first_edit_at = null;
      st.plan_created_at = null;
      st.plan_approved_at = null;
      st.plan_warning_sent = false;
      st.last_activity = new Date().toISOString();
      if (!writeState(directory, st)) {
        logAudit(directory, {
          event: "state_write_failed",
          scope: "create_task",
          task_id,
        });
        return {
          status: "error",
          reason:
            "Task card written but state.json persist failed. Fix disk/permissions and retry create_task().",
        };
      }

      logAudit(directory, { event: "task_created", task_id, priority });
      incrementMetric(directory, "tasks_created", 1, task_id, sessionId);
      return {
        status: "success",
        task_path: `.opencode/pending/open/${task_id}.json`,
        message: `Task ${task_id} created. Next: call create_plan() for non-trivial tasks.`,
      };
    },
  };
}

export function createPlanTool(context) {
  return {
    description: "Create a structured plan for a task",
    args: {
      task_id: { type: "string" },
      affected_files: { type: "array", items: { type: "string" } },
      risk_level: { type: "string", enum: ["low", "medium", "high"] },
      acceptance_criteria: { type: "array", items: { type: "string" } },
    },
    async execute(args) {
      const { task_id, affected_files, risk_level, acceptance_criteria } = args;
      const { directory, sessionId } = context;

      const cfg = getConfig(directory);
      const budgetCheck = checkBudget(directory, "create_plan");
      if (!budgetCheck.allowed) {
        return { status: "error", reason: budgetCheck.reason };
      }
      if (affected_files.length > cfg.budget_limits.max_files) {
        return {
          status: "error",
          reason: `Budget exceeded: max ${cfg.budget_limits.max_files} files per task`,
        };
      }

      const plansDir = join(directory, OPENC_DIR, "plans");
      ensureDir(plansDir);
      const plan = {
        task_id,
        affected_files,
        risk_level,
        acceptance_criteria,
        created_at: new Date().toISOString(),
      };
      // v11.4: critical write — never claim success on failure
      const planWritten = writeFileContent(
        join(plansDir, `${task_id}.json`),
        JSON.stringify(plan, null, 2),
      );
      if (!planWritten) {
        logAudit(directory, { event: "plan_write_failed", task_id });
        return {
          status: "error",
          reason: `Failed to write plan .opencode/plans/${task_id}.json (disk full or permissions). Plan NOT created.`,
        };
      }

      const st = readState(directory);
      const editsBeforePlan = !!st.first_edit_at && !st.plan_created_at;
      st.plan_created_at = new Date().toISOString();
      st.phase = "plan";
      if (!writeState(directory, st)) {
        logAudit(directory, {
          event: "state_write_failed",
          scope: "create_plan",
          task_id,
        });
        return {
          status: "error",
          reason:
            "Plan written but state.json persist failed. plan_created_at not recorded — fix disk/permissions and retry.",
        };
      }

      let warning = null;
      if (editsBeforePlan) {
        warning =
          "PROTOCOL VIOLATION: code was edited before create_plan(). Plan gate requires plan FIRST.";
        logAudit(directory, {
          event: "protocol_violation",
          task_id,
          violation: "edits_before_plan",
        });
        incrementMetric(
          directory,
          "protocol_violations",
          1,
          task_id,
          sessionId,
        );
      }

      logAudit(directory, { event: "plan_created", task_id, risk_level });
      incrementMetric(directory, "plans_created", 1, task_id, sessionId);
      return {
        status: "success",
        plan_path: `.opencode/plans/${task_id}.json`,
        warning,
        next: "STOP and wait for explicit user approval, then call approve_plan().",
      };
    },
  };
}

export function approvePlanTool(context) {
  return {
    description:
      "Record explicit user approval of a plan. Required before implementation for non-trivial tasks.",
    args: {
      task_id: { type: "string" },
    },
    async execute(args) {
      const { task_id } = args;
      const { directory, sessionId } = context;
      const plansDir = join(directory, OPENC_DIR, "plans");
      const approvalsDir = join(directory, OPENC_DIR, "approvals");
      const planFile = join(plansDir, `${task_id}.json`);

      if (!existsSync(planFile)) {
        return {
          status: "error",
          reason: `Plan for task ${task_id} not found. Call create_plan() first.`,
        };
      }

      const plan = JSON.parse(readFileSync(planFile, "utf8"));
      const now = new Date().toISOString();
      ensureDir(approvalsDir);
      const approval = {
        task_id,
        risk_level: plan.risk_level,
        approved_at: now,
        source: "user_explicit_approval",
      };
      // v11.4: critical write — never claim success on failure
      const approvalWritten = writeFileContent(
        join(approvalsDir, `${task_id}.plan_approved.json`),
        JSON.stringify(approval, null, 2),
      );
      if (!approvalWritten) {
        logAudit(directory, { event: "approval_write_failed", task_id });
        return {
          status: "error",
          reason: `Failed to write approval .opencode/approvals/${task_id}.plan_approved.json. Approval NOT recorded.`,
        };
      }

      const st = readState(directory);
      const editsBeforeApproval = !!st.first_edit_at && !st.plan_approved_at;
      st.plan_approved_at = now;
      if (!writeState(directory, st)) {
        logAudit(directory, {
          event: "state_write_failed",
          scope: "approve_plan",
          task_id,
        });
        return {
          status: "error",
          reason:
            "Approval written but state.json persist failed. plan_approved_at not recorded — fix disk/permissions and retry.",
        };
      }

      let warning = null;
      if (editsBeforeApproval) {
        warning =
          "PROTOCOL VIOLATION: code was edited before plan approval. Plan gate requires approval BEFORE any code.";
        logAudit(directory, {
          event: "protocol_violation",
          task_id,
          violation: "edits_before_approval",
        });
        incrementMetric(
          directory,
          "protocol_violations",
          1,
          task_id,
          sessionId,
        );
      }

      logAudit(directory, {
        event: "plan_approved",
        task_id,
        risk_level: plan.risk_level,
      });
      incrementMetric(directory, "plans_approved", 1, task_id, sessionId);
      return {
        status: "success",
        approval_path: `.opencode/approvals/${task_id}.plan_approved.json`,
        warning,
        message: `Plan for ${task_id} approved. Implementation allowed.`,
      };
    },
  };
}

export function waiveReviewTool(context) {
  return {
    description:
      "Operator override: record an audited waiver of the Fresh Critic gate. Use ONLY on explicit user order.",
    args: {
      task_id: { type: "string" },
      reason: { type: "string" },
    },
    async execute(args) {
      const { task_id, reason } = args;
      const { directory, sessionId } = context;

      if (!reason || reason.trim().length === 0) {
        return { status: "error", reason: "Waiver reason cannot be empty" };
      }

      const approvalsDir = join(directory, OPENC_DIR, "approvals");
      ensureDir(approvalsDir);
      const waiver = {
        task_id,
        reason,
        waived_at: new Date().toISOString(),
        waived_by: "operator_explicit_order",
      };
      // v11.4: critical write — never claim success on failure
      const waiverWritten = writeFileContent(
        join(approvalsDir, `${task_id}.review_waived.json`),
        JSON.stringify(waiver, null, 2),
      );
      if (!waiverWritten) {
        logAudit(directory, { event: "waiver_write_failed", task_id });
        return {
          status: "error",
          reason: `Failed to write waiver .opencode/approvals/${task_id}.review_waived.json. Waiver NOT recorded.`,
        };
      }

      logAudit(directory, { event: "review_waived", task_id, reason });
      incrementMetric(directory, "reviews_waived", 1, task_id, sessionId);
      return {
        status: "success",
        waiver_path: `.opencode/approvals/${task_id}.review_waived.json`,
        message: `Review gate waived for ${task_id}. Waiver recorded in receipt.`,
      };
    },
  };
}

// v11.3: explicit commit tool; v11.4: wired in index.js, honors explicit type/scope args
export function commitChangesTool(context) {
  return {
    description:
      "Commit changes with conventional commit message. Format: type(scope): summary [TASK-XXX]",
    args: {
      task_id: { type: "string" },
      type: {
        type: "string",
        enum: [
          "feat",
          "fix",
          "docs",
          "style",
          "refactor",
          "test",
          "chore",
          "perf",
          "ci",
        ],
      },
      scope: { type: "string" },
      summary: { type: "string" },
      files: { type: "array", items: { type: "string" }, optional: true },
    },
    async execute(args) {
      const { task_id, type, scope, summary, files } = args;
      const { directory, sessionId } = context;

      let filesToCommit = files || [];
      if (filesToCommit.length === 0) {
        const st = readState(directory);
        filesToCommit = Array.isArray(st.task_files) ? [...st.task_files] : [];
      }
      if (filesToCommit.length === 0) {
        return {
          status: "error",
          reason:
            "No files to commit. Edit files first or specify files explicitly.",
        };
      }

      // v11.4: build message from explicit args.
      // gitAddAndCommit() re-derives type from task_id and would ignore them.
      const sanitizedScope =
        String(scope || "general")
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "") || "general";
      const subject =
        summary.length > 50 ? summary.slice(0, 50) + "..." : summary;
      const message = `${type}(${sanitizedScope}): ${subject} [${task_id}]`;

      const addResult = gitAdd(directory, filesToCommit);
      if (!addResult.success) {
        logAudit(directory, {
          event: "git_commit_failed",
          task_id,
          reason: `git add failed: ${addResult.reason}`,
        });
        return {
          status: "error",
          reason: `git add failed: ${addResult.reason}`,
        };
      }

      const commitResult = gitCommit(directory, message);
      if (!commitResult.success) {
        logAudit(directory, {
          event: "git_commit_failed",
          task_id,
          reason: `git commit failed: ${commitResult.reason}`,
        });
        return {
          status: "error",
          reason: `git commit failed: ${commitResult.reason}`,
        };
      }

      logAudit(directory, {
        event: "git_commit_success",
        task_id,
        commit_hash: commitResult.commit_hash,
        message,
      });
      incrementMetric(directory, "git_commits", 1, task_id, sessionId);
      return {
        status: "success",
        commit_hash: commitResult.commit_hash,
        message,
        files_count: filesToCommit.length,
        task_id,
      };
    },
  };
}

export function completeTaskTool(context) {
  return {
    description: "Complete a task with evidence-based receipt",
    args: {
      task_id: { type: "string" },
      summary: { type: "string" },
    },
    async execute(args) {
      const { task_id, summary } = args;
      const { directory, sessionId, lastPreflightResult } = context;
      const pendingOpenDir = join(directory, OPENC_DIR, "pending/open");
      const pendingResolvedDir = join(directory, OPENC_DIR, "pending/resolved");
      const receiptsDir = join(directory, OPENC_DIR, "receipts");
      const approvalsDir = join(directory, OPENC_DIR, "approvals");
      const reviewsDir = join(directory, OPENC_DIR, "reviews");
      const plansDir = join(directory, OPENC_DIR, "plans");
      const memoryDir = join(directory, OPENC_DIR, "memory");

      const budgetCheck = checkBudget(directory, "complete_task");
      if (!budgetCheck.allowed) {
        return { status: "error", reason: budgetCheck.reason };
      }

      const taskFile = join(pendingOpenDir, `${task_id}.json`);
      if (!existsSync(taskFile)) {
        return {
          status: "error",
          reason: `Task ${task_id} not found in pending/open/`,
        };
      }

      let taskData = {};
      try {
        taskData = JSON.parse(readFileSync(taskFile, "utf8"));
      } catch (e) {
        /* ignore */
      }

      let planData = null;
      const planFile = join(plansDir, `${task_id}.json`);
      if (existsSync(planFile)) {
        try {
          planData = JSON.parse(readFileSync(planFile, "utf8"));
        } catch (e) {
          /* ignore */
        }
      }

      let approvalData = null;
      const planApprovalFile = join(
        approvalsDir,
        `${task_id}.plan_approved.json`,
      );
      if (existsSync(planApprovalFile)) {
        try {
          approvalData = JSON.parse(readFileSync(planApprovalFile, "utf8"));
        } catch (e) {
          /* ignore */
        }
      }

      const st0 = readState(directory);
      const changedFiles = Array.isArray(st0.task_files)
        ? [...st0.task_files]
        : [];

      const cfg = getConfig(directory);
      const impactMap = cfg.impactMapCompiled;
      const highRiskFiles = changedFiles.filter((f) => {
        const riskRule = impactMap.find((r) => r.pattern.test(f));
        return riskRule && riskRule.risk === "high" && riskRule.approval;
      });
      if (highRiskFiles.length > 0) {
        const approvalFile = join(approvalsDir, `${task_id}.approved.json`);
        if (!existsSync(approvalFile)) {
          return {
            status: "error",
            reason: `High-risk changes require approval`,
            high_risk_files: highRiskFiles,
            instruction: `Create ${approvalFile} with {"status": "approved"} and retry`,
          };
        }
      }

      // v11.1: ХАРД-ГЕЙТ нетривиальности — 2+ файла требуют plan + approval
      if (changedFiles.length >= 2) {
        if (!planData) {
          return {
            status: "error",
            reason: `Non-trivial task (${changedFiles.length} changed files) requires create_plan()`,
            instruction: `Call create_plan() listing affected files, get explicit user approval, call approve_plan(${task_id}), then retry`,
          };
        }
        if (!approvalData) {
          return {
            status: "error",
            reason: `Non-trivial task (${changedFiles.length} changed files) requires an approved plan`,
            instruction: `Get explicit user approval and call approve_plan(${task_id}) before complete_task()`,
          };
        }
      }

      let riskIdx = 0;
      const consider = (level) => {
        const i = RISK_ORDER[level];
        if (i !== undefined && i > riskIdx) riskIdx = i;
      };
      consider(planData && planData.risk_level);
      consider(approvalData && approvalData.risk_level);
      consider(taskData.risk_level);
      for (const f of changedFiles) {
        const riskRule = impactMap.find((r) => r.pattern.test(f));
        if (riskRule) consider(riskRule.risk);
      }
      const taskRisk =
        riskIdx === 2 ? "high" : riskIdx === 1 ? "medium" : "low";

      if ((taskRisk === "medium" || taskRisk === "high") && !approvalData) {
        return {
          status: "error",
          reason: `${taskRisk}-risk task requires an approved plan`,
          instruction: `Get explicit user approval and call approve_plan(${task_id}) before complete_task()`,
        };
      }

      let reviewWaived = false;
      let waiverReason = null;
      let criticResult = null;
      if (taskRisk === "medium" || taskRisk === "high") {
        const waiverFile = join(approvalsDir, `${task_id}.review_waived.json`);
        if (existsSync(waiverFile)) {
          try {
            const w = JSON.parse(readFileSync(waiverFile, "utf8"));
            reviewWaived = true;
            waiverReason = w.reason || null;
          } catch (e) {
            /* ignore */
          }
        }
        const reviewFile = join(reviewsDir, `${task_id}.json`);
        if (!existsSync(reviewFile) && !reviewWaived) {
          return {
            status: "error",
            reason: `${taskRisk}-risk task requires Fresh Critic review`,
            instruction: `Call request_review(${task_id}), or on explicit user order call waive_review(${task_id}, reason)`,
          };
        }
        if (existsSync(reviewFile)) {
          try {
            criticResult = JSON.parse(readFileSync(reviewFile, "utf8"));
          } catch (e) {
            /* ignore */
          }
          if (
            criticResult &&
            criticResult.verdict !== "approved" &&
            !reviewWaived
          ) {
            return {
              status: "error",
              reason: `Fresh Critic verdict: ${criticResult.verdict}`,
              feedback: criticResult.feedback,
              instruction: `Address feedback and call request_review() again`,
            };
          }
        }
      }

      let preflight = lastPreflightResult;
      if (!preflight || !preflight.passed) {
        preflight = await runPreflight(directory, changedFiles);
        context.lastPreflightResult = preflight;
        logAudit(directory, {
          event: "preflight_result",
          scope: "complete_task",
          passed: preflight.passed,
          step: preflight.step || null,
          kind: preflight.kind || null,
          steps: preflight.steps || [],
        });
      }

      const violations = detectOrderViolations(st0);
      if (violations.length > 0) {
        logAudit(directory, {
          event: "protocol_violations_recorded",
          task_id,
          violations,
        });
        incrementMetric(
          directory,
          "protocol_violations",
          violations.length,
          task_id,
          sessionId,
        );
      }

      // v11.2: собираем git diff и сохраняем артефакты
      const evidencePackage = gatherEvidence(
        directory,
        sessionId || "unknown",
        changedFiles,
        preflight,
        criticResult,
        null,
      );

      const fullDiff = getGitDiff(directory, changedFiles);
      if (fullDiff.available && sessionId && sessionId !== "unknown") {
        saveArtifact(directory, sessionId, "git_diff", {
          diff: fullDiff.diff,
          size_bytes: fullDiff.size_bytes,
          files_count: fullDiff.files_count,
        });
      }
      if (preflight && sessionId && sessionId !== "unknown") {
        saveArtifact(directory, sessionId, "preflight", preflight);
      }

      const evidence = {
        task_id,
        summary,
        changed_files: changedFiles,
        risk_level: taskRisk,
        preflight,
        git_diff_stat: evidencePackage.git,
        protocol_violations: violations,
        review_waived: reviewWaived,
        waiver_reason: waiverReason,
        artifacts_session: sessionId || "unknown",
        completed_at: new Date().toISOString(),
      };

      if (!evidence.preflight.passed) {
        return {
          status: "error",
          reason: `Pre-flight did not pass (step: ${evidence.preflight.step})`,
          details: evidence.preflight,
        };
      }

      const sessionStart = new Date(
        st0.session_started_at || st0.started_at || 0,
      ).getTime();
      const facts = readFactsJsonl(directory);
      const directHit = facts.some((f) => f.source_task === task_id);
      const fallbackFacts = facts.filter(
        (f) =>
          (f.source_task === "current" || !f.source_task) &&
          new Date(f.created_at).getTime() >= sessionStart,
      );

      const noOpTaskFile = join(memoryDir, `no_op_${task_id}.json`);
      let noOpExists = existsSync(noOpTaskFile);
      let noOpFallback = null;
      if (!noOpExists) {
        try {
          for (const f of readdirSync(memoryDir)) {
            const m = f.match(/^no_op_(.+)\.json$/);
            if (m) {
              try {
                const obj = JSON.parse(
                  readFileSync(join(memoryDir, f), "utf8"),
                );
                const matchesTask = obj.task_id === task_id;
                const matchesSession =
                  !obj.task_id &&
                  new Date(obj.created_at).getTime() >= sessionStart;
                if (matchesTask || matchesSession) {
                  noOpFallback = join(memoryDir, f);
                  break;
                }
              } catch (e) {
                /* ignore */
              }
            }
          }
        } catch (e) {
          /* ignore */
        }
      }

      const memoryUpdated =
        directHit || fallbackFacts.length > 0 || noOpExists || !!noOpFallback;
      if (!memoryUpdated) {
        return {
          status: "error",
          reason:
            "Memory not updated. Call memory_add(task_id=...) or memory_no_op(task_id=...) before complete_task()",
        };
      }

      if (!directHit && fallbackFacts.length > 0) {
        const ids = new Set(fallbackFacts.map((f) => f.id));
        const factsPath = join(memoryDir, "facts.jsonl");
        try {
          const lines = readFileSync(factsPath, "utf8")
            .split("\n")
            .filter((l) => l.trim());
          const out = lines.map((l) => {
            try {
              const o = JSON.parse(l);
              if (ids.has(o.id)) o.source_task = task_id;
              return JSON.stringify(o);
            } catch (e) {
              return l;
            }
          });
          writeFileSync(factsPath, out.join("\n") + "\n");
          regenerateMemoryMd(directory);
          logAudit(directory, {
            event: "memory_relinked",
            task_id,
            count: ids.size,
          });
        } catch (e) {
          /* ignore */
        }
      }

      if (!noOpExists && noOpFallback) {
        try {
          renameSync(noOpFallback, noOpTaskFile);
          logAudit(directory, { event: "no_op_relinked", task_id });
        } catch (e) {
          /* ignore */
        }
      }

      ensureDir(receiptsDir);
      // v11.4: critical write — never claim success on failure
      const receiptWritten = writeFileContent(
        join(receiptsDir, `${task_id}.json`),
        JSON.stringify(evidence, null, 2),
      );
      if (!receiptWritten) {
        logAudit(directory, { event: "receipt_write_failed", task_id });
        return {
          status: "error",
          reason: `Failed to write receipt .opencode/receipts/${task_id}.json. Task NOT completed.`,
        };
      }

      ensureDir(pendingResolvedDir);
      renameSync(taskFile, join(pendingResolvedDir, `${task_id}.json`));

      // v11.3: Автокоммит если включен в state
      let gitCommitResult = null;
      const st = readState(directory);
      if (st.auto_commit && changedFiles.length > 0) {
        const domain =
          planData?.affected_files?.[0]?.split("/")[0] || "general";
        gitCommitResult = gitAddAndCommit(
          directory,
          changedFiles,
          task_id,
          summary,
          domain,
        );
        if (gitCommitResult.success) {
          logAudit(directory, {
            event: "auto_commit_success",
            task_id,
            commit_hash: gitCommitResult.commit_hash,
          });
          incrementMetric(directory, "git_commits", 1, task_id, sessionId);
        } else {
          logAudit(directory, {
            event: "auto_commit_failed",
            task_id,
            reason: gitCommitResult.reason,
          });
        }
      }

      st.phase = "done";
      st.attempts = (st.attempts || 0) + 1;
      st.task_files = [];
      st.plan_warning_sent = false;
      st.last_activity = new Date().toISOString();
      // v11.4: receipt + resolved task already persisted; state failure is a warning, not a rollback
      let stateWarning = null;
      if (!writeState(directory, st)) {
        stateWarning =
          "state.json persist failed after completion. Receipt and resolved task are written; state may be stale until next create_task(). Check disk/permissions.";
        logAudit(directory, {
          event: "state_write_failed",
          scope: "complete_task",
          task_id,
        });
      }

      logAudit(directory, {
        event: "task_completed",
        task_id,
        violations: violations.length,
        review_waived: reviewWaived,
      });
      incrementMetric(directory, "tasks_completed", 1, task_id, sessionId);
      return {
        status: "success",
        receipt_path: `.opencode/receipts/${task_id}.json`,
        protocol_violations: violations,
        review_waived: reviewWaived,
        git_diff_available: evidencePackage.git.available,
        git_commit: gitCommitResult,
        artifacts_session: sessionId || "unknown",
        state_warning: stateWarning,
        message: `Task ${task_id} completed successfully`,
      };
    },
  };
}
