import { getConfig } from "../config.js";
import { readState } from "../utils/fs.js";

export function checkBudget(directory, action) {
  const state = readState(directory);
  const cfg = getConfig(directory);
  const limits = cfg.budget_limits;

  const hasActiveTask = !!state.task_id && state.phase !== "completed" && state.phase !== "aborted";

  if (action === "create_plan" || action === "complete_task") {
    if (!hasActiveTask) return { allowed: true };
    if ((state.attempts || 0) >= limits.max_attempts) {
      return { allowed: false, reason: `Budget exceeded: max ${limits.max_attempts} attempts per task` };
    }
    const startRef = state.task_started_at || state.started_at || new Date().toISOString();
    const elapsedMinutes = (Date.now() - new Date(startRef).getTime()) / 60000;
    if (elapsedMinutes >= limits.max_minutes) {
      return { allowed: false, reason: `Budget exceeded: max ${limits.max_minutes} minutes per task (elapsed: ${Math.floor(elapsedMinutes)})` };
    }
  }

  return { allowed: true };
}
