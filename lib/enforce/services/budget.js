import { getConfig } from "../config.js";
import { readState } from "../utils/fs.js";

export function checkBudget(directory, action) {
  const state = readState(directory);
  const cfg = getConfig(directory);
  const BUDGET_LIMITS = cfg.budget_limits;

  if (action === "restart") {
    if ((state.restarts || 0) >= BUDGET_LIMITS.max_restarts) {
      return {
        allowed: false,
        reason: `Budget exceeded: max ${BUDGET_LIMITS.max_restarts} restarts per session`,
      };
    }
    return { allowed: true };
  }

  const hasActiveTask = !!state.task_id && state.phase !== "done";

  if (action === "create_plan" || action === "complete_task") {
    if (!hasActiveTask) {
      return { allowed: true };
    }
    if ((state.attempts || 0) >= BUDGET_LIMITS.max_attempts) {
      return {
        allowed: false,
        reason: `Budget exceeded: max ${BUDGET_LIMITS.max_attempts} attempts per task`,
      };
    }
    const startRef =
      state.task_started_at ||
      state.session_started_at ||
      state.started_at ||
      new Date().toISOString();
    const elapsedMinutes = (Date.now() - new Date(startRef).getTime()) / 60000;
    if (elapsedMinutes >= BUDGET_LIMITS.max_minutes) {
      return {
        allowed: false,
        reason: `Budget exceeded: max ${BUDGET_LIMITS.max_minutes} minutes per task (elapsed: ${Math.floor(elapsedMinutes)})`,
      };
    }
  }

  return { allowed: true };
}

export function detectOrderViolations(state) {
  const violations = [];
  if (
    state.first_edit_at &&
    state.plan_created_at &&
    new Date(state.first_edit_at).getTime() <
      new Date(state.plan_created_at).getTime()
  ) {
    violations.push("edits_before_plan");
  }
  if (
    state.first_edit_at &&
    state.plan_approved_at &&
    new Date(state.first_edit_at).getTime() <
      new Date(state.plan_approved_at).getTime()
  ) {
    violations.push("edits_before_approval");
  }
  return violations;
}
