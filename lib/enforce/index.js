import { PluginContext } from "./context.js";
import { initDatabase } from "./services/db.js";
import { createEventHandler } from "./events.js";
import { defineTool } from "./tools/wrapper.js";
import { enforcePreExecutionPolicy } from "./services/guard.js";
import {
  taskStartTool,
  taskVerifyTool,
  taskCommitTool,
  taskRollbackTool,
} from "./tools/task.js";

export const EnforcePlugin = async ({ client, directory }) => {
  const context = new PluginContext(directory);
  const db = initDatabase(directory);

  try {
    await client.app.log({
      body: {
        service: "enforce-plugin",
        level: "info",
        message: "Enforce-TDD V2 initialized. Storage: node:sqlite (.opencode/enforce.db).",
      },
    });
  } catch (e) {
    // ignore logging errors
  }

  return {
    "tool.execute.before": async (input, output) => {
      enforcePreExecutionPolicy(input.tool, output?.args, directory, db);
    },

    event: createEventHandler(client, context, db),
    tool: {
      task_start: defineTool(taskStartTool(context, db)),
      task_verify: defineTool(taskVerifyTool(context, db)),
      task_commit: defineTool(taskCommitTool(context, db)),
      task_rollback: defineTool(taskRollbackTool(context, db)),
    },
  };
};

export default EnforcePlugin;
