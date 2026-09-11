import { relative, resolve, isAbsolute } from "node:path";
import { readState } from "../utils/fs.js";

const MUTATING_TOOLS = new Set(["edit", "write", "apply_patch"]);

const SCOPE_EXEMPT = [
  /^\.opencode\//,
  /^\.git\//,
  /(^|\/)AGENTS\.md$/,
];

function normalizePath(targetPath, rootDir) {
  if (!targetPath) return null;
  const abs = isAbsolute(targetPath) ? targetPath : resolve(rootDir, targetPath);
  return relative(rootDir, abs);
}

function extractTargetFiles(toolName, args, rootDir) {
  const files = [];

  if (toolName === "edit" || toolName === "write") {
    const raw = args?.filePath || args?.file || args?.path;
    if (raw) files.push(normalizePath(raw, rootDir));
  } else if (toolName === "apply_patch") {
    const patch = args?.patchText || "";
    const matches = patch.matchAll(/\*\*\* (?:Update|Add|Delete) File:\s*([^\r\n]+)/g);
    for (const match of matches) {
      if (match[1]) files.push(normalizePath(match[1].trim(), rootDir));
    }
  }

  return files.filter(Boolean);
}

export function enforcePreExecutionPolicy(toolName, args, directory) {
  if (!MUTATING_TOOLS.has(toolName)) return;

  const targetFiles = extractTargetFiles(toolName, args, directory);
  if (targetFiles.length === 0) return;

  const nonExemptFiles = targetFiles.filter(
    (relPath) => !SCOPE_EXEMPT.some((re) => re.test(relPath)),
  );

  if (nonExemptFiles.length === 0) return;

  const st = readState(directory);
  const hasActiveTask = Boolean(
    st.task_id && st.phase !== "completed" && st.phase !== "aborted",
  );

  if (!hasActiveTask) {
    throw new Error(
      `[ENFORCE VIOLATION: NO_ACTIVE_TASK]\n` +
      `File modifications blocked for: ${nonExemptFiles.join(", ")}.\n` +
      `PROTOCOL REQUIREMENT: You MUST initialize a task before modifying code.\n` +
      `NEXT ACTION: Call begin_task(task_id, description, files_whitelist, priority).`,
    );
  }

  if (st.phase === "planning") {
    throw new Error(
      `[ENFORCE VIOLATION: PLAN_NOT_READY]\n` +
      `Task '${st.task_id}' is in 'planning' phase.\n` +
      `PROTOCOL REQUIREMENT: Scope must be declared before edits.\n` +
      `NEXT ACTION: Call create_plan(task_id, affected_files, risk_level, acceptance_criteria).`,
    );
  }

  const whitelist = st.files_whitelist || [];
  if (whitelist.length > 0) {
    const unlisted = nonExemptFiles.filter((f) => !whitelist.includes(f));
    if (unlisted.length > 0) {
      throw new Error(
        `[ENFORCE VIOLATION: SCOPE_CREEP]\n` +
        `Modification blocked. File(s) not in whitelist: [${unlisted.join(", ")}].\n` +
        `Active Whitelist: [${whitelist.join(", ")}].\n` +
        `NEXT ACTION: Re-plan or edit only whitelisted files.`,
      );
    }
  }
}
