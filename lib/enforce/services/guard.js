import { relative, resolve, isAbsolute } from "node:path";
import { getState } from "./db.js";

const MUTATING_TOOLS = new Set(["edit", "write", "apply_patch"]);

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
  }
  if (toolName === "apply_patch") {
    const patch = args?.patchText || "";
    const matches = patch.matchAll(/\*\*\* (?:Update|Add|Delete) File:\s*([^\r\n]+)/g);
    for (const m of matches) {
      if (m[1]) files.push(normalizePath(m[1].trim(), rootDir));
    }
  }
  return files.filter(Boolean);
}

export function enforcePreExecutionPolicy(toolName, args, directory, db) {
  if (!MUTATING_TOOLS.has(toolName)) return;

  const targetFiles = extractTargetFiles(toolName, args, directory);
  if (targetFiles.length === 0) return;

  const state = getState(db);
  if (!state || state.phase === "idle" || state.phase === "completed" || state.phase === "aborted") {
    throw new Error(`[ENFORCE] Модификация заблокирована: нет активной задачи. Вызовите task_start().`);
  }

  const whitelist = state.files_whitelist || [];
  const testFiles = state.test_files || [];

  for (const targetFile of targetFiles) {
    if (state.phase === "tdd_red") {
      if (!testFiles.includes(targetFile)) {
        throw new Error(
          `[ENFORCE: TDD_RED_VIOLATION]\n` +
          `Попытка изменения '${targetFile}' в фазе RED. Разрешены только тесты: [${testFiles.join(", ")}].`,
        );
      }
    }

    if (state.phase === "tdd_green" || state.phase === "validated") {
      if (testFiles.includes(targetFile)) {
        throw new Error(
          `[ENFORCE: TEST_LOCK_VIOLATION]\n` +
          `Тесты заблокированы на запись. Запрещено менять '${targetFile}'. Исправляйте код в: [${whitelist.join(", ")}].`,
        );
      }
      if (!whitelist.includes(targetFile)) {
        throw new Error(`[ENFORCE: SCOPE_CREEP] Файл '${targetFile}' не входит в whitelist.`);
      }
    }
  }
}
