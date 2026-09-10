import { getConfig } from "./config.js";
import { readState, writeState } from "./utils/fs.js";
import { trimOutput } from "./utils/strings.js";
import { runPreflight, isControlPlaneFile } from "./services/preflight.js";

const SCOPE_EXEMPT = [
  /\.opencode\//,
  /\.git\//,
  /(^|\/)AGENTS\.md$/,
];

function isScopeExempt(filePath) {
  return SCOPE_EXEMPT.some((re) => re.test(filePath));
}

export function createEventHandler(client, context) {
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
      const st = readState(directory);
      st.session_started_at = new Date().toISOString();
      st.session_id = context.sessionId || null;
      st.last_activity = new Date().toISOString();
      writeState(directory, st);
    }

    if (event.type === "file.edited") {
      const f = p.file ?? p.filePath ?? p.path;
      if (!f) return;

      const rel = f.startsWith(prefix) ? f.slice(prefix.length) : f;

      // Exempt files: .opencode/**, .git/**, AGENTS.md
      if (isScopeExempt(rel)) return;

      // Control plane files: warn but don't block
      if (isControlPlaneFile(rel, directory)) return;

      const st = readState(directory);

      // TOCTOU: any edit to a non-exempt file resets validated flag
      if (st.validated) {
        st.validated = false;
        writeState(directory, st);
      }

      // Scope enforcement: if files_whitelist is set, check membership
      const whitelist = st.files_whitelist || [];
      if (whitelist.length > 0 && st.phase !== "completed" && st.phase !== "aborted") {
        if (!whitelist.includes(rel)) {
          context.winEdited.add(rel);
          // Don't block — just warn. Agent may legitimately edit adjacent files.
          // Blocking is too aggressive for Lite architecture.
        }
      }

      context.winEdited.add(rel);
    }

    if (event.type === "session.idle") {
      if (context.winEdited.size === 0) return;

      const batch = [...context.winEdited];
      context.winEdited.clear();

      // Circuit breaker
      const cfg = getConfig(directory);
      if (context.consecutiveFailures >= (cfg.budget_limits?.max_consecutive_failures || 5)) {
        if (!context.breakerNotified) {
          context.breakerNotified = true;
          await sendMessage(
            context.sessionId,
            `Circuit breaker: preflight failed ${context.consecutiveFailures} times. Automated checks paused.`,
          );
        }
        return;
      }

      // Run preflight on edited files
      const preflight = await runPreflight(directory, batch);
      context.lastPreflightResult = preflight;

      if (!preflight.passed) {
        context.consecutiveFailures += 1;
        const compactOutput = trimOutput(preflight.output, 10);

        const st = readState(directory);
        st.last_preflight_passed = false;
        st.validated = false;
        st.last_activity = new Date().toISOString();
        writeState(directory, st);

        await sendMessage(
          context.sessionId,
          `Pre-flight failed (${preflight.step}):\n\`\`\`\n${compactOutput}\n\`\`\`\n\nFix the error and save — check re-runs automatically.`,
        );
        return;
      }

      context.consecutiveFailures = 0;
      context.breakerNotified = false;

      const st = readState(directory);
      st.last_preflight_passed = true;
      st.last_activity = new Date().toISOString();
      writeState(directory, st);
    }
  };
}
