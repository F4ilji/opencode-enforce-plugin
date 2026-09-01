import { join } from "node:path";
import { OPENC_DIR, getConfig } from "../config.js";
import { readState, writeState } from "../utils/fs.js";
import { logAudit, incrementMetric } from "../utils/audit.js";
import {
  createDefaultState,
  migrateToExecutionState,
  applyDelta,
} from "../services/execution-state.js";

function getOrCreateExecState(directory) {
  const st = readState(directory);
  if (st.plan && typeof st.plan === "object" && "acceptance_criteria" in st.plan) {
    return st;
  }
  const migrated = migrateToExecutionState(st);
  const merged = { ...st, ...migrated };
  writeState(directory, merged);
  return merged;
}

export function transitionStepTool(context) {
  return {
    description:
      "Advance to the next execution step with state updates (SKILL.state protocol). " +
      "Use after each meaningful action to update structured state instead of relying on chat history.",
    args: {
      completed_subgoal_id: { type: "string", optional: true },
      next_subgoal_id: { type: "string", optional: true },
      resolved_blocker: { type: "string", optional: true },
      new_blocker: { type: "string", optional: true },
      hypothesis: { type: "string", optional: true },
      phase: {
        type: "string",
        enum: ["intake", "planning", "implementing", "verifying", "review", "completed"],
        optional: true,
      },
      observation: { type: "string", optional: true },
    },
    async execute(args) {
      const { directory, sessionId } = context;

      const delta = {};
      if (args.completed_subgoal_id) delta.completed_subgoal_id = args.completed_subgoal_id;
      if (args.next_subgoal_id) delta.next_subgoal_id = args.next_subgoal_id;
      if (args.resolved_blocker) delta.resolved_blocker = args.resolved_blocker;
      if (args.new_blocker) delta.new_blocker = args.new_blocker;
      if (args.hypothesis) delta.hypothesis = args.hypothesis;
      if (args.phase) delta.phase = args.phase;
      if (args.observation) delta.observation = args.observation;

      const current = getOrCreateExecState(directory);
      const next = applyDelta(current, delta);

      if (!writeState(directory, next)) {
        logAudit(directory, { event: "state_write_failed", scope: "transition_step" });
        return {
          status: "error",
          reason: "Failed to persist execution state. Fix disk/permissions and retry.",
        };
      }

      logAudit(directory, {
        event: "state_transition",
        task_id: next.task_id,
        phase: next.phase,
        step_index: next.step_index,
        delta_keys: Object.keys(delta),
      });
      incrementMetric(directory, "state_transitions", 1, next.task_id, sessionId);

      return {
        status: "state_updated",
        task_id: next.task_id,
        phase: next.phase,
        step_index: next.step_index,
        diagnostics: next.diagnostics,
        blockers: next.working_context?.known_blockers || [],
        subgoals: (next.plan?.subgoals || []).map(sg => ({
          id: sg.id,
          description: sg.description,
          status: sg.status,
        })),
      };
    },
  };
}

export function decomposeSubgoalsTool(context) {
  return {
    description:
      "Decompose a plan into explicit subgoals for SKILL.state tracking. " +
      "Call once after create_plan() for non-trivial tasks.",
    args: {
      task_id: { type: "string" },
      subgoals: {
        type: "array",
        items: { type: "string" },
      },
    },
    async execute(args) {
      const { task_id, subgoals: descriptions } = args;
      const { directory, sessionId } = context;

      if (!descriptions || descriptions.length === 0) {
        return { status: "error", reason: "subgoals cannot be empty" };
      }

      const current = getOrCreateExecState(directory);

      const subgoals = descriptions.map((desc, i) => ({
        id: `${task_id}-step-${i + 1}`,
        description: desc,
        status: i === 0 ? "in_progress" : "pending",
      }));

      const delta = {
        phase: "implementing",
        observation: `Decomposed into ${subgoals.length} subgoals. First subgoal started.`,
      };
      delta.completed_subgoal_id = null;

      const next = applyDelta(current, delta);
      next.plan = {
        ...next.plan,
        subgoals,
      };
      next.task_id = task_id;

      if (!writeState(directory, next)) {
        return { status: "error", reason: "Failed to persist subgoals" };
      }

      logAudit(directory, {
        event: "subgoals_decomposed",
        task_id,
        count: subgoals.length,
      });
      incrementMetric(directory, "subgoals_created", subgoals.length, task_id, sessionId);

      return {
        status: "success",
        task_id,
        subgoals: subgoals.map(sg => ({
          id: sg.id,
          description: sg.description,
          status: sg.status,
        })),
      };
    },
  };
}
