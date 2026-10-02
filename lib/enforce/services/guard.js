import { relative, resolve, isAbsolute } from "node:path";
import { getState } from "./db.js";

const MUTATING_TOOLS = new Set(["edit", "write", "apply_patch"]);

function normalizePath(targetPath, rootDir) {
  if (!targetPath) return null;
  const abs = isAbsolute(targetPath) ? targetPath : resolve(rootDir, targetPath);
  return relative(rootDir, abs);
}

function extractTargetFile(toolName, args, rootDir) {
  if (toolName === "edit" || toolName === "write") {
    const raw = args?.filePath || args?.file || args?.path;
    return raw ? normalizePath(raw, rootDir) : null;
  }
  if (toolName === "apply_patch") {
    const patch = args?.patchText || "";
    const match = patch.match(/\*\*\* (?:Update|Add|Delete) File:\s*([^\r\n]+)/);
    return match?.[1] ? normalizePath(match[1].trim(), rootDir) : null;
  }
  return null;
}

export function enforcePreExecutionPolicy(toolName, args, directory, db) {
  if (!MUTATING_TOOLS.has(toolName)) return;

  const targetFile = extractTargetFile(toolName, args, directory);
  if (!targetFile) return;

  const state = getState(db);

  if (!state || state.phase === "idle" || state.phase === "completed" || state.phase === "aborted") {
    throw new Error(
      `[ENFORCE] Модификация заблокирована: нет активной задачи. Вызовите task_start().`,
    );
  }

  const whitelist = state.files_whitelist || [];
  const testFiles = state.test_files || [];

  if (state.phase === "tdd_red") {
    if (!testFiles.includes(targetFile)) {
      throw new Error(
        `[ENFORCE: TDD_RED_VIOLATION]\n` +
        `Попытка изменения файла реализации '${targetFile}' в фазе RED.\n` +
        `Сначала напишите падающие тесты в: [${testFiles.join(", ")}].`,
      );
    }
    return;
  }

  if (state.phase === "tdd_green" || state.phase === "validated") {
    if (testFiles.includes(targetFile)) {
      throw new Error(
        `[ENFORCE: TEST_LOCK_VIOLATION]\n` +
        `Тесты заблокированы на запись. Запрещено ослаблять ассерты.\n` +
        `Исправляйте реализацию в: [${whitelist.join(", ")}].`,
      );
    }
    if (!whitelist.includes(targetFile)) {
      throw new Error(`[ENFORCE: SCOPE_CREEP] Файл '${targetFile}' не входит в whitelist.`);
    }
  }
}
