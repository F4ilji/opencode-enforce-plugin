import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { OPENC_DIR, getConfig } from "../config.js";
import { readState, readTechDebt } from "../utils/fs.js";
import { loadRouterConfig } from "../services/critic.js";
import { detectOrderViolations } from "../services/budget.js";
import { hasGitRepo, hasGitCommits } from "../services/evidence.js";

export function getDashboardTool(context) {
  return {
    description: "Get observability dashboard with metrics and tech debt",
    args: {},
    async execute() {
      const { directory } = context;
      const cfg = getConfig(directory);
      const BUDGET_LIMITS = cfg.budget_limits;
      const techDebt = readTechDebt(directory);
      const metricsPath = join(directory, OPENC_DIR, "metrics.jsonl");

      let metrics = {};
      if (existsSync(metricsPath)) {
        const lines = readFileSync(metricsPath, "utf8")
          .split("\n")
          .filter((l) => l.trim());
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (!metrics[entry.metric]) metrics[entry.metric] = 0;
            metrics[entry.metric] += entry.value;
          } catch (e) {
            /* ignore */
          }
        }
      }

      const state = readState(directory);

      // v11.4: the task budget timer only runs while a task is active. A done
      // task must not keep accruing elapsed time, or a stale task_started_at
      // yields a false "exceeded".
      const hasActiveTask = !!state.task_id && state.phase !== "done";
      const taskRef =
        state.task_started_at ||
        state.session_started_at ||
        state.started_at ||
        new Date().toISOString();
      const elapsedMinutes = hasActiveTask
        ? Math.floor((Date.now() - new Date(taskRef).getTime()) / 60000)
        : 0;

      const routerCfg = loadRouterConfig(directory);

      // v11.2: считаем артефакты
      const artifactsDir = join(directory, OPENC_DIR, "artifacts");
      let artifactsCount = 0;
      let artifactsSessions = [];
      if (existsSync(artifactsDir)) {
        try {
          const sessions = readdirSync(artifactsDir);
          artifactsSessions = sessions;
          artifactsCount = sessions.reduce((acc, session) => {
            const sessionPath = join(artifactsDir, session);
            try {
              return (
                acc +
                readdirSync(sessionPath).filter((f) => f.endsWith(".json"))
                  .length
              );
            } catch (e) {
              return acc;
            }
          }, 0);
        } catch (e) {
          /* ignore */
        }
      }

      const gitAvailable = hasGitRepo(directory) && hasGitCommits(directory);

      const dashboard = {
        session: {
          task_id: state.task_id || null,
          elapsed_minutes: elapsedMinutes,
          attempts: state.attempts || 0,
          restarts: state.restarts || 0,
          phase: state.phase || "unknown",
          task_files_count: Array.isArray(state.task_files)
            ? state.task_files.length
            : 0,
          session_id: context.sessionId || "unknown",
        },
        budget: {
          attempts: `${state.attempts || 0}/${BUDGET_LIMITS.max_attempts}`,
          restarts: `${state.restarts || 0}/${BUDGET_LIMITS.max_restarts}`,
          minutes: `${elapsedMinutes}/${BUDGET_LIMITS.max_minutes}`,
          status: !hasActiveTask
            ? "idle"
            : (state.attempts || 0) >= BUDGET_LIMITS.max_attempts ||
                elapsedMinutes >= BUDGET_LIMITS.max_minutes
              ? "exceeded"
              : "ok",
        },
        ordering: {
          first_edit_at: state.first_edit_at || null,
          plan_created_at: state.plan_created_at || null,
          plan_approved_at: state.plan_approved_at || null,
          violations: detectOrderViolations(state),
        },
        routerai: {
          configured: !!routerCfg.apiKey,
          model: routerCfg.model,
          apiKeySource: routerCfg.apiKeySource,
          modelSource: routerCfg.modelSource,
        },
        git: {
          available: gitAvailable,
          has_commits: hasGitCommits(directory),
        },
        artifacts: {
          total_files: artifactsCount,
          sessions: artifactsSessions,
        },
        metrics,
        tech_debt_count: Object.keys(techDebt).length,
        circuit_breaker: {
          consecutive_failures: context.consecutiveFailures,
          status: context.consecutiveFailures >= 5 ? "open" : "closed",
        },
      };

      return { status: "success", dashboard };
    },
  };
}
