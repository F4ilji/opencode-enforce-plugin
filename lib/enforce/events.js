import { execFile } from "node:child_process";
import { getConfig } from "./config.js";
import { readState, writeState } from "./utils/fs.js";
import { logAudit, incrementMetric } from "./utils/audit.js";
import { trimOutput } from "./utils/strings.js";
import {
  isControlPlaneFile,
  isServiceFile,
  serviceFor,
  runPreflight,
  waitForHealth,
} from "./services/preflight.js";
import { checkBudget } from "./services/budget.js";

function execFileAsync(file, args, opts) {
  return new Promise((resolve) => {
    execFile(file, args, opts, (error, stdout, stderr) => {
      if (error) {
        resolve({
          status: error.code === "ETIMEDOUT" ? -1 : (error.status ?? -1),
          stdout: stdout || "",
          stderr: stderr || error.message,
          error,
        });
      } else {
        resolve({ status: 0, stdout: stdout || "", stderr: stderr || "" });
      }
    });
  });
}

export function createEventHandler(client, context) {
  const { directory } = context;
  const prefix = directory.endsWith("/") ? directory : directory + "/";

  const sendMessage = async (sid, text) => {
    try {
      await client.session.prompt({
        path: { id: sid },
        body: { parts: [{ type: "text", text }] },
      });
      return true;
    } catch (e) {
      await client.app.log({
        body: {
          service: "enforce-plugin",
          level: "error",
          message: `sendMessage failed: ${String(e.message ?? e)}`,
        },
      });
      return false;
    }
  };

  return async ({ event }) => {
    const p = event.properties ?? {};

    if (event.type === "session.created" || event.type === "session.updated") {
      context.sessionId = p.sessionID || p.id || context.sessionId;
    }

    if (event.type === "session.created") {
      const st = readState(directory);
      st.session_started_at = new Date().toISOString();
      st.restarts = 0;
      st.session_id = context.sessionId || null;
      st.last_activity = new Date().toISOString();
      writeState(directory, st);
    }

    if (event.type === "file.edited") {
      const f = p.file ?? p.filePath ?? p.path;
      if (f) {
        const rel = f.startsWith(prefix) ? f.slice(prefix.length) : f;

        if (isControlPlaneFile(rel, directory)) {
          logAudit(directory, { event: "control_plane_edited", file: rel });
          incrementMetric(
            directory,
            "control_plane_edits",
            1,
            null,
            context.sessionId,
          );
        }

        if (!isServiceFile(rel, directory)) {
          context.winEdited.add(rel);

          const st = readState(directory);
          const current = Array.isArray(st.task_files)
            ? new Set(st.task_files)
            : new Set();
          current.add(rel);
          st.task_files = [...current];
          if (!st.first_edit_at) st.first_edit_at = new Date().toISOString();

          // v11.1: real-time warning — 2+ файла без плана
          if (
            st.task_files.length >= 2 &&
            !st.plan_created_at &&
            !st.plan_warning_sent
          ) {
            st.plan_warning_sent = true;
            writeState(directory, st);
            logAudit(directory, {
              event: "protocol_violation",
              violation: "multi_file_edits_without_plan",
              files: st.task_files,
            });
            incrementMetric(
              directory,
              "protocol_violations",
              1,
              st.task_id || null,
              context.sessionId,
            );
            await sendMessage(
              context.sessionId,
              `⚠️ Protocol violation: ${st.task_files.length} files edited without create_plan(). ` +
                `Non-trivial tasks (2+ files) require plan + explicit approval BEFORE code. Call create_plan() now.`,
            );
          } else {
            writeState(directory, st);
          }
        }
      }
    }

    if (event.type === "session.idle") {
      if (context.winEdited.size > 0) {
        const batch = [...context.winEdited];
        context.winEdited.clear();
        context.winRestarted.clear();

        const cfg = getConfig(directory);
        if (context.consecutiveFailures >= (cfg.budget_limits?.max_consecutive_failures || 5)) {
          if (!context.breakerNotified) {
            context.breakerNotified = true;
            await sendMessage(
              context.sessionId,
              `🛑 Circuit breaker: pre-flight failed ${context.consecutiveFailures} times in a row. ` +
                `Automated injections paused. Fix the code manually, split the task, or ask the user for guidance.`,
            );
            logAudit(directory, {
              event: "circuit_breaker_open",
              consecutiveFailures: context.consecutiveFailures,
            });
            incrementMetric(
              directory,
              "circuit_breaker_open",
              1,
              null,
              context.sessionId,
            );
          }
          return;
        }

        const preflight = await runPreflight(directory, batch);
        context.lastPreflightResult = preflight;
        logAudit(directory, {
          event: "preflight_result",
          passed: preflight.passed,
          step: preflight.step || null,
          kind: preflight.kind || null,
          files: batch,
          steps: preflight.steps || [],
        });

        if (!preflight.passed) {
          context.consecutiveFailures += 1;

          const compactOutput = trimOutput(preflight.output, 10);

          const st = readState(directory);
          if (!st.plan || typeof st.plan !== "object" || !("acceptance_criteria" in st.plan)) {
            st.plan = st.plan || {};
            st.plan.acceptance_criteria = st.plan.acceptance_criteria || [];
            st.plan.subgoals = st.plan.subgoals || [];
          }
          if (!st.working_context || typeof st.working_context !== "object") {
            st.working_context = { modified_files: [], active_hypotheses: [], known_blockers: [] };
          }
          if (!st.diagnostics || typeof st.diagnostics !== "object") {
            st.diagnostics = { last_preflight_passed: true, failing_step: null, error_summary: null };
          }
          st.diagnostics.last_preflight_passed = false;
          st.diagnostics.failing_step = preflight.step;
          st.diagnostics.error_summary = compactOutput.slice(0, 300);
          st.last_observation = `Preflight failed at ${preflight.step}: ${compactOutput.slice(0, 200)}`;
          st.last_activity = new Date().toISOString();
          writeState(directory, st);

          const msg = `❌ Pre-flight failed (${preflight.step}):\n\`\`\`\n${compactOutput}\n\`\`\`\n\nFix the error and save the file — the check re-runs automatically.`;

          await sendMessage(context.sessionId, msg);
          logAudit(directory, {
            event: "preflight_failed",
            step: preflight.step,
            kind: preflight.kind,
          });
          incrementMetric(
            directory,
            "preflight_failed",
            1,
            null,
            context.sessionId,
          );
          return;
        }

        context.consecutiveFailures = 0;
        context.breakerNotified = false;
        incrementMetric(
          directory,
          "preflight_passed",
          1,
          null,
          context.sessionId,
        );

        {
          const st = readState(directory);
          if (!st.plan || typeof st.plan !== "object" || !("acceptance_criteria" in st.plan)) {
            st.plan = st.plan || {};
            st.plan.acceptance_criteria = st.plan.acceptance_criteria || [];
            st.plan.subgoals = st.plan.subgoals || [];
          }
          if (!st.working_context || typeof st.working_context !== "object") {
            st.working_context = { modified_files: [], active_hypotheses: [], known_blockers: [] };
          }
          if (!st.diagnostics || typeof st.diagnostics !== "object") {
            st.diagnostics = { last_preflight_passed: true, failing_step: null, error_summary: null };
          }
          st.diagnostics.last_preflight_passed = true;
          st.diagnostics.failing_step = null;
          st.diagnostics.error_summary = null;
          st.last_observation = `Preflight passed. Steps: ${preflight.steps.map(s => s.name).join(", ")}`;
          st.last_activity = new Date().toISOString();
          writeState(directory, st);
        }

        const ruffStep = preflight.steps.find((s) => s.name === "ruff");
        if (ruffStep && ruffStep.status === "pass" && ruffStep.observed > 0) {
          incrementMetric(
            directory,
            "ruff_debt_observed",
            ruffStep.observed,
            null,
            context.sessionId,
          );
        }

        const neededServices = new Set();
        for (const f of batch) {
          const svc = serviceFor(f, directory);
          if (svc) neededServices.add(svc);
        }

        for (const svc of neededServices) {
          const budgetCheck = checkBudget(directory, "restart");
          if (!budgetCheck.allowed) {
            await sendMessage(
              context.sessionId,
              `🛑 Budget exceeded: ${budgetCheck.reason}. Restart blocked.`,
            );
            logAudit(directory, {
              event: "budget_exceeded",
              action: "restart",
              reason: budgetCheck.reason,
            });
            continue;
          }

          try {
            await execFileAsync("docker", ["compose", "restart", svc], {
              cwd: directory,
              timeout: 60000,
            });
            const st = readState(directory);
            st.restarts = (st.restarts || 0) + 1;
            writeState(directory, st);
            logAudit(directory, { event: "docker_restart", service: svc });
            incrementMetric(
              directory,
              "successful_restarts",
              1,
              null,
              context.sessionId,
            );

            const health = await waitForHealth(directory, svc, 30000);
            if (!health.healthy) {
              const logsRes = await execFileAsync(
                "docker",
                ["compose", "logs", "--tail", "50", svc],
                {
                  cwd: directory,
                  encoding: "utf8",
                  timeout: 10000,
                },
              );
              const logs =
                logsRes.stdout || logsRes.stderr || "No logs available";
              await sendMessage(
                context.sessionId,
                `⚠️ Service ${svc} restarted but is unhealthy (status: ${health.status}).\nLogs:\n${trimOutput(logs, 30)}`,
              );
              incrementMetric(
                directory,
                "healthcheck_failures",
                1,
                null,
                context.sessionId,
              );
            } else {
              await sendMessage(
                context.sessionId,
                `✅ Service ${svc} restarted and healthy.${health.assumed ? " (Assumed healthy, no healthcheck configured)" : ""}`,
              );
            }
          } catch (e) {
            logAudit(directory, {
              event: "restart_error",
              service: svc,
              error: e.message,
            });
          }
        }
      }
    }
  };
}
