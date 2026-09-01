import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { OPENC_DIR, ROUTERAI_CHAT_ENDPOINT, getConfig } from "../config.js";
import { ensureDir, readState } from "../utils/fs.js";
import { logAudit, incrementMetric } from "../utils/audit.js";
import { loadRouterConfig, callCritic } from "../services/critic.js";
import {
  getGitDiff,
  getGitDiffStat,
  hasGitRepo,
  hasGitCommits,
  saveArtifact,
} from "../services/evidence.js";

const DEFAULT_CRITIC_PROMPT = `You are a Fresh Critic — an independent code reviewer.
Your role:
- Verify surgical edits (no implicit refactoring)
- Check consistency with existing patterns
- Validate acceptance criteria
- Flag security issues clearly
- Focus on CHANGES shown in the diff, not pre-existing code, unless it violates a critical rule
- Be terse and direct

Apply rules proportionally to task scope:
- Trivial tasks (single file, <50 lines): only flag security issues and syntax errors
- Medium tasks: apply all architecture rules
- High-risk tasks: full strict review including tests, error handling

Respond in JSON format:
{
"verdict": "approved" | "changes_requested",
"feedback": ["specific issue 1", "specific issue 2"]
}`;

export function requestReviewTool(context) {
  return {
    description:
      "Request Fresh Critic review via RouterAI. Uses git diff when available.",
    args: {
      task_id: { type: "string" },
      focus_areas: { type: "array", items: { type: "string" }, optional: true },
      changes_summary: { type: "string", optional: true },
    },
    async execute(args) {
      const { task_id, focus_areas = [], changes_summary } = args;
      const { directory, sessionId, lastPreflightResult } = context;
      const plansDir = join(directory, OPENC_DIR, "plans");
      const reviewsDir = join(directory, OPENC_DIR, "reviews");
      const pendingOpenDir = join(directory, OPENC_DIR, "pending/open");
      const pendingResolvedDir = join(directory, OPENC_DIR, "pending/resolved");
      const planFile = join(plansDir, `${task_id}.json`);

      if (!existsSync(planFile)) {
        return {
          status: "error",
          reason: `Plan for task ${task_id} not found. Call create_plan() first.`,
        };
      }

      const plan = JSON.parse(readFileSync(planFile, "utf8"));

      let taskDescription = null;
      for (const dir of [pendingOpenDir, pendingResolvedDir]) {
        const taskCard = join(dir, `${task_id}.json`);
        if (existsSync(taskCard)) {
          try {
            taskDescription = JSON.parse(
              readFileSync(taskCard, "utf8"),
            ).description;
            break;
          } catch (e) {
            /* ignore */
          }
        }
      }

      let reviewFiles = plan.affected_files || [];
      let fallbackUsed = false;
      if (reviewFiles.length === 0) {
        const st = readState(directory);
        const persisted = Array.isArray(st.task_files) ? st.task_files : [];
        if (persisted.length > 0) {
          reviewFiles = persisted;
          fallbackUsed = true;
        } else {
          return {
            status: "error",
            reason:
              "Nothing to review: affected_files is empty and no files were edited in this session",
            instruction:
              "Add files to plan.affected_files or edit files first, then retry",
          };
        }
      }

      let diffContent = null;
      let diffStat = null;
      let gitUsed = false;
      if (hasGitRepo(directory) && hasGitCommits(directory)) {
        const diffResult = getGitDiff(directory, reviewFiles);
        if (diffResult.available) {
          diffContent = diffResult.diff;
          diffStat = getGitDiffStat(directory, reviewFiles).stat;
          gitUsed = true;
        }
      }

      let filesContent = [];
      if (!gitUsed) {
        for (const filePath of reviewFiles) {
          const fullPath = join(directory, filePath);
          if (existsSync(fullPath)) {
            filesContent.push({
              path: filePath,
              content: readFileSync(fullPath, "utf8"),
            });
          }
        }
      }

      const cfg = loadRouterConfig(directory);
      const projectCfg = getConfig(directory);
      const systemPrompt = projectCfg.critic_system_prompt || DEFAULT_CRITIC_PROMPT;

      if (lastPreflightResult && sessionId && sessionId !== "unknown") {
        saveArtifact(directory, sessionId, "preflight", lastPreflightResult);
      }

      const userPromptParts = [
        `Task ID: ${task_id}`,
        `Risk Level: ${plan.risk_level}`,
        `Acceptance Criteria: ${plan.acceptance_criteria.join(", ")}`,
      ];
      if (taskDescription)
        userPromptParts.push(`Task Description: ${taskDescription}`);
      if (changes_summary)
        userPromptParts.push(
          `Changes Summary (what and why):\n${changes_summary}`,
        );
      if (focus_areas.length > 0)
        userPromptParts.push(`Focus Areas: ${focus_areas.join(", ")}`);

      if (diffContent) {
        userPromptParts.push(
          `\nGit diff (HEAD vs working tree):\n\`\`\`diff\n${diffContent}\n\`\`\``,
        );
        if (diffStat) userPromptParts.push(`\nDiff stat:\n${diffStat}`);
        userPromptParts.push(
          "\nReview ONLY the changes shown in the diff. Ignore unchanged code unless it violates a critical rule.",
        );
      } else {
        userPromptParts.push(
          `\nNote: git diff unavailable, reviewing full files:\n${filesContent.map((f) => `\n=== ${f.path} ===\n${f.content}`).join("\n")}`,
        );
      }

      if (fallbackUsed && !diffContent)
        userPromptParts.push(
          `\nNote: review files inferred from session edits (plan.affected_files was empty)`,
        );

      userPromptParts.push("\nProvide your verdict and specific feedback.");

      const result = await callCritic(
        systemPrompt,
        userPromptParts.join("\n"),
        cfg,
      );

      if (result.error) {
        logAudit(directory, {
          event: "critic_error",
          task_id,
          error: result.error,
          model: cfg.model,
          modelSource: cfg.modelSource,
        });
        return {
          status: "error",
          reason: result.error,
          model_used: cfg.model,
          model_source: cfg.modelSource,
        };
      }

      ensureDir(reviewsDir);
      const review = {
        task_id,
        verdict: result.verdict,
        feedback: result.feedback,
        model_used: cfg.model,
        model_source: cfg.modelSource,
        git_diff_used: gitUsed,
        diff_size_bytes: diffContent ? diffContent.length : 0,
        fallback_files_used: fallbackUsed,
        created_at: new Date().toISOString(),
      };
      writeFileSync(
        join(reviewsDir, `${task_id}.json`),
        JSON.stringify(review, null, 2),
      );

      if (sessionId && sessionId !== "unknown") {
        saveArtifact(directory, sessionId, "critic", review);
      }

      logAudit(directory, {
        event: "review_created",
        task_id,
        verdict: result.verdict,
        model: cfg.model,
        modelSource: cfg.modelSource,
        git_used: gitUsed,
        fallback: fallbackUsed,
      });
      incrementMetric(directory, "reviews_created", 1, task_id, sessionId);
      return {
        status: "success",
        verdict: result.verdict,
        feedback: result.feedback,
        model_used: cfg.model,
        model_source: cfg.modelSource,
        git_diff_used: gitUsed,
        diff_size_bytes: diffContent ? diffContent.length : 0,
        files_reviewed: reviewFiles.length,
        fallback_used: fallbackUsed,
        review_path: `.opencode/reviews/${task_id}.json`,
      };
    },
  };
}

export function pingCriticTool(context) {
  return {
    description:
      "Check if RouterAI API is reachable (health check, no code review)",
    args: {},
    async execute() {
      const cfg = loadRouterConfig(context.directory);
      if (!cfg.apiKey) {
        return {
          status: "error",
          reason:
            "ROUTERAI_API_KEY not found (checked: process.env, .env, .opencode/routerai.env)",
        };
      }

      const start = Date.now();
      try {
        const response = await fetch(ROUTERAI_CHAT_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${cfg.apiKey}`,
          },
          body: JSON.stringify({
            model: cfg.model,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 5,
          }),
        });
        const latencyMs = Date.now() - start;
        if (response.ok) {
          return {
            status: "success",
            model: cfg.model,
            model_source: cfg.modelSource,
            latency_ms: latencyMs,
            message: "RouterAI API reachable",
          };
        } else {
          return {
            status: "error",
            reason: `HTTP ${response.status}`,
            model: cfg.model,
            latency_ms: latencyMs,
            details: await response.text(),
          };
        }
      } catch (e) {
        return {
          status: "error",
          reason: e.message,
          model: cfg.model,
          latency_ms: Date.now() - start,
        };
      }
    },
  };
}
