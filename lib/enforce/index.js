import { PluginContext } from "./context.js";
import { loadRouterConfig } from "./services/critic.js";
import { createEventHandler } from "./events.js";
import { defineTool } from "./tools/wrapper.js";
import { enforcePreExecutionPolicy } from "./services/guard.js";
import {
  beginTaskTool,
  createPlanTool,
  approvePlanTool,
  validateChangesTool,
  waiveReviewTool,
  commitTaskTool,
  abortTaskTool,
} from "./tools/task.js";

export const EnforcePlugin = async ({ client, directory }) => {
  const context = new PluginContext(directory);
  const startupCfg = loadRouterConfig(directory);

  try {
    await client.app.log({
      body: {
        service: "enforce-plugin",
        level: "info",
        message: `Enforce-Lite initialized. RouterAI: ${startupCfg.apiKey ? `key from ${startupCfg.apiKeySource}, model=${startupCfg.model}` : "KEY NOT FOUND"}.`,
      },
    });
  } catch (e) {
    // ignore logging errors
  }

  return {
    "tool.execute.before": async (input, output) => {
      enforcePreExecutionPolicy(input.tool, output?.args, directory);
    },

    event: createEventHandler(client, context),
    tool: {
      begin_task: defineTool(beginTaskTool(context)),
      create_plan: defineTool(createPlanTool(context)),
      approve_plan: defineTool(approvePlanTool(context)),
      validate_changes: defineTool(validateChangesTool(context)),
      waive_review: defineTool(waiveReviewTool(context)),
      commit_task: defineTool(commitTaskTool(context)),
      abort_task: defineTool(abortTaskTool(context)),
    },
  };
};

export default EnforcePlugin;
