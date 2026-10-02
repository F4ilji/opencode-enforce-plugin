import { getState, updatePhase } from "./services/db.js";
import { checkTokenLimit, circuitBreakerMessage } from "./services/token_guard.js";
import { runPreflight, isControlPlaneFile } from "./services/preflight.js";

const SCOPE_EXEMPT = [
  /\.opencode\//,
  /\.git\//,
  /(^|\/)AGENTS\.md$/,
];

function isScopeExempt(filePath) {
  return SCOPE_EXEMPT.some((re) => re.test(filePath));
}

const ACTIVE_PHASES = ["tdd_red", "tdd_green", "validated"];

export function createEventHandler(client, context, db) {
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
      return false;
    }
  };

  return async ({ event }) => {
    const p = event.properties ?? {};

    if (event.type === "session.created" || event.type === "session.updated") {
      context.sessionId = p.sessionID || p.id || context.sessionId;
    }

    if (event.type === "session.created") {
      const state = getState(db);
      if (state && ACTIVE_PHASES.includes(state.phase)) {
        updatePhase(db, state.phase, { current_session_id: context.sessionId, session_tokens: 0 });
        const impl = (state.files_whitelist || []).join(", ");
        const tests = (state.test_files || []).join(", ");
        await sendMessage(
          context.sessionId,
          `[REHYDRATION] Active Task: ${state.task_id}. Phase: ${state.phase}. ` +
          `Impl: [${impl}]. Tests: [${tests}]${state.phase !== "tdd_red" ? " (locked)." : "."} ` +
          `Baseline: ${state.baseline_sha.slice(0, 8)}.`,
        );
      }
    }

    if (event.type === "message.part.updated" || event.type === "message.updated") {
      const state = getState(db);
      if (state && ACTIVE_PHASES.includes(state.phase)) {
        const text = JSON.stringify(p.part ?? p.message ?? "");
        const tokens = (state.session_tokens || 0) + Math.ceil(text.length / 4);
        if (checkTokenLimit(tokens)) {
          updatePhase(db, state.phase, { session_tokens: tokens });
          await sendMessage(context.sessionId, circuitBreakerMessage());
          return;
        }
        updatePhase(db, state.phase, { session_tokens: tokens });
      }
    }

    if (event.type === "file.edited" || (event.type === "file.watcher.updated" && p.event === "add")) {
      const f = p.file ?? p.filePath ?? p.path;
      if (!f) return;
      const rel = f.startsWith(prefix) ? f.slice(prefix.length) : f;
      if (isScopeExempt(rel)) return;
      if (isControlPlaneFile(rel, directory)) return;
      context.winEdited.add(rel);
    }

    if (event.type === "session.idle") {
      if (context.winEdited.size === 0) return;
      const batch = [...context.winEdited];
      context.winEdited.clear();

      if (context.consecutiveFailures >= 5) {
        if (!context.breakerNotified) {
          context.breakerNotified = true;
          await sendMessage(
            context.sessionId,
            `Circuit breaker: preflight failed ${context.consecutiveFailures} times. Automated checks paused.`,
          );
        }
        return;
      }

      const preflight = await runPreflight(directory, batch);
      context.lastPreflightResult = preflight;

      if (!preflight.passed) {
        context.consecutiveFailures += 1;
        const compactOutput = (preflight.output || "").split("\n").slice(-10).join("\n");
        await sendMessage(
          context.sessionId,
          `Pre-flight failed (${preflight.step}):\n\`\`\`\n${compactOutput}\n\`\`\`\n\nFix the error and save — check re-runs automatically.`,
        );
        return;
      }

      context.consecutiveFailures = 0;
      context.breakerNotified = false;
    }
  };
}
