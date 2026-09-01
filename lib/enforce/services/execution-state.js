/**
 * ExecutionState — компактное структурированное состояние выполнения задачи.
 * Вдохновлено SKILL.state (arXiv:2608.26263): замена append-only истории
 * на mutable state + latest observation.
 */

const PHASES = ["intake", "planning", "implementing", "verifying", "review", "completed"];
const SUBGOAL_STATUSES = ["pending", "in_progress", "completed", "failed"];

function createDefaultState() {
  return {
    task_id: null,
    phase: "intake",
    step_index: 0,

    plan: {
      acceptance_criteria: [],
      subgoals: [],
    },

    working_context: {
      modified_files: [],
      active_hypotheses: [],
      known_blockers: [],
    },

    diagnostics: {
      last_preflight_passed: true,
      failing_step: null,
      error_summary: null,
    },

    last_observation: null,
    last_activity: null,
  };
}

function validatePhase(phase) {
  return PHASES.includes(phase) ? phase : "intake";
}

function validateSubgoalStatus(status) {
  return SUBGOAL_STATUSES.includes(status) ? status : "pending";
}

/**
 * Миграция существующего state.json → ExecutionState формат.
 * Обратно-совместимо: старые поля сохраняются, новые добавляются.
 */
function migrateToExecutionState(oldState) {
  const exec = createDefaultState();

  if (oldState.task_id) exec.task_id = oldState.task_id;
  if (oldState.phase) exec.phase = validatePhase(oldState.phase);
  if (typeof oldState.step_index === "number") exec.step_index = oldState.step_index;
  if (oldState.last_activity) exec.last_activity = oldState.last_activity;

  if (oldState.task_files?.length > 0) {
    exec.working_context.modified_files = [...oldState.task_files];
  }

  if (oldState.plan_created_at && !oldState.plan_approved_at) {
    exec.phase = "planning";
  } else if (oldState.plan_approved_at && oldState.phase !== "done") {
    exec.phase = "implementing";
  } else if (oldState.phase === "done") {
    exec.phase = "completed";
  }

  return exec;
}

/**
 * Применяет delta к execution state.
 * Возвращает обновлённое состояние.
 */
function applyDelta(state, delta) {
  const next = { ...state, last_activity: new Date().toISOString() };

  if (delta.phase) next.phase = validatePhase(delta.phase);

  if (delta.completed_subgoal_id && next.plan?.subgoals) {
    next.plan.subgoals = next.plan.subgoals.map(sg =>
      sg.id === delta.completed_subgoal_id
        ? { ...sg, status: "completed" }
        : sg
    );
  }

  if (delta.next_subgoal_id && next.plan?.subgoals) {
    next.plan.subgoals = next.plan.subgoals.map(sg =>
      sg.id === delta.next_subgoal_id
        ? { ...sg, status: "in_progress" }
        : sg
    );
  }

  if (delta.new_blocker) {
    next.working_context = {
      ...next.working_context,
      known_blockers: [...(next.working_context.known_blockers || []), delta.new_blocker],
    };
  }

  if (delta.resolved_blocker) {
    next.working_context = {
      ...next.working_context,
      known_blockers: (next.working_context.known_blockers || []).filter(
        b => b !== delta.resolved_blocker
      ),
    };
  }

  if (delta.hypothesis) {
    next.working_context = {
      ...next.working_context,
      active_hypotheses: [...(next.working_context.active_hypotheses || []), delta.hypothesis],
    };
  }

  if (delta.file_added) {
    const files = new Set(next.working_context.modified_files || []);
    files.add(delta.file_added);
    next.working_context.modified_files = [...files];
  }

  if (delta.file_removed) {
    next.working_context = {
      ...next.working_context,
      modified_files: (next.working_context.modified_files || []).filter(
        f => f !== delta.file_removed
      ),
    };
  }

  if (delta.preflight_result) {
    next.diagnostics = {
      last_preflight_passed: delta.preflight_result.passed,
      failing_step: delta.preflight_result.passed ? null : delta.preflight_result.step || null,
      error_summary: delta.preflight_result.passed
        ? null
        : (delta.preflight_result.output || "").slice(0, 300),
    };
  }

  if (delta.observation) {
    next.last_observation = typeof delta.observation === "string"
      ? delta.observation
      : JSON.stringify(delta.observation).slice(0, 500);
  }

  if (typeof delta.step_index === "number") {
    next.step_index = delta.step_index;
  } else {
    next.step_index = (next.step_index || 0) + 1;
  }

  return next;
}

/**
 * Генерирует компактный промпт для LLM на основе SKILL.state протокола.
 * Возвращает { system_context, state_snapshot, observation }
 */
function buildPromptInput(state, skillContract) {
  return {
    system_context: skillContract,
    state_snapshot: {
      task_id: state.task_id,
      phase: state.phase,
      step_index: state.step_index,
      acceptance_criteria: state.plan?.acceptance_criteria || [],
      subgoals: (state.plan?.subgoals || []).map(sg => ({
        id: sg.id,
        description: sg.description,
        status: sg.status,
      })),
      modified_files: state.working_context?.modified_files || [],
      active_hypotheses: state.working_context?.active_hypotheses || [],
      known_blockers: state.working_context?.known_blockers || [],
      diagnostics: state.diagnostics || {},
    },
    observation: state.last_observation || null,
  };
}

export {
  createDefaultState,
  migrateToExecutionState,
  applyDelta,
  buildPromptInput,
  PHASES,
  SUBGOAL_STATUSES,
};
