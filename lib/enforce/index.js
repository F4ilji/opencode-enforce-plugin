import { PluginContext } from "./context.js";
import { migratePhase0 } from "./services/migration.js";
import { loadRouterConfig } from "./services/critic.js";
import { createEventHandler } from "./events.js";
import { defineTool } from "./tools/wrapper.js";
import {
  createTaskTool,
  createPlanTool,
  approvePlanTool,
  waiveReviewTool,
  commitChangesTool,
  completeTaskTool,
} from "./tools/task.js";
import { memoryAddTool, memoryNoOpTool } from "./tools/memory-tools.js";
import { requestReviewTool, pingCriticTool } from "./tools/review.js";
import { getDashboardTool } from "./tools/observability.js";

export const EnforcePlugin = async ({ client, directory }) => {
  const context = new PluginContext(directory);
  const startupCfg = loadRouterConfig(directory);
  try {
    migratePhase0(directory);
    await client.app.log({
      body: {
        service: "enforce-plugin",
        level: "info",
        message: `Phase 0-5: migration complete (v11.4 hardening). RouterAI: ${startupCfg.apiKey ? `key from ${startupCfg.apiKeySource}, model=${startupCfg.model} from ${startupCfg.modelSource}` : "KEY NOT FOUND"}.`,
      },
    });
  } catch (e) {
    await client.app.log({
      body: {
        service: "enforce-plugin",
        level: "error",
        message: `Phase 0 failed: ${e.message}`,
      },
    });
  }

  return {
    event: createEventHandler(client, context),
    tool: {
      create_task: defineTool(createTaskTool(context)),
      create_plan: defineTool(createPlanTool(context)),
      approve_plan: defineTool(approvePlanTool(context)),
      waive_review: defineTool(waiveReviewTool(context)),
      commit_changes: defineTool(commitChangesTool(context)),
      complete_task: defineTool(completeTaskTool(context)),
      memory_add: defineTool(memoryAddTool(context)),
      memory_no_op: defineTool(memoryNoOpTool(context)),
      request_review: defineTool(requestReviewTool(context)),
      ping_critic: defineTool(pingCriticTool(context)),
      get_dashboard: defineTool(getDashboardTool(context)),
    },
  };
};

export default EnforcePlugin;
