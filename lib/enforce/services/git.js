import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { hasGitRepo, hasGitCommits } from "./evidence.js";

// Проверяет статус git (modified/untracked файлы)
export function gitStatus(directory) {
  if (!hasGitRepo(directory)) {
    return { available: false, reason: "No git repo" };
  }

  try {
    const res = spawnSync("git", ["status", "--porcelain"], {
      cwd: directory,
      encoding: "utf8",
      timeout: 5000,
    });

    if (res.status !== 0) {
      return { available: false, reason: `git status failed: ${res.stderr}` };
    }

    const lines = res.stdout
      .trim()
      .split("\n")
      .filter((l) => l.trim());
    const modified = lines
      .filter((l) => l.startsWith(" M") || l.startsWith("M "))
      .map((l) => l.slice(3).trim());
    const untracked = lines
      .filter((l) => l.startsWith("??"))
      .map((l) => l.slice(3).trim());
    const staged = lines
      .filter((l) => l.startsWith("M ") || l.startsWith("A "))
      .map((l) => l.slice(3).trim());

    return {
      available: true,
      modified,
      untracked,
      staged,
      has_changes: lines.length > 0,
      total_changes: lines.length,
    };
  } catch (e) {
    return { available: false, reason: e.message };
  }
}

// Git add файлов
export function gitAdd(directory, files = []) {
  if (!hasGitRepo(directory)) {
    return { success: false, reason: "No git repo" };
  }

  try {
    const args = ["add"];
    if (files.length > 0) {
      args.push("--", ...files);
    } else {
      args.push("-A"); // add all
    }

    const res = spawnSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      timeout: 10000,
    });

    if (res.status !== 0) {
      return { success: false, reason: `git add failed: ${res.stderr}` };
    }

    return { success: true, files_added: files.length };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

// Git commit с сообщением
export function gitCommit(directory, message, author = null) {
  if (!hasGitRepo(directory)) {
    return { success: false, reason: "No git repo" };
  }

  try {
    const args = ["commit", "-m", message];
    if (author) {
      args.push("--author", author);
    }

    const res = spawnSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      timeout: 10000,
    });

    if (res.status !== 0) {
      return { success: false, reason: `git commit failed: ${res.stderr}` };
    }

    // Получаем hash последнего коммита
    const hashRes = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: directory,
      encoding: "utf8",
      timeout: 5000,
    });

    const commitHash = hashRes.status === 0 ? hashRes.stdout.trim() : null;

    return {
      success: true,
      commit_hash: commitHash,
      message,
    };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

// Получить текущую ветку
export function getCurrentBranch(directory) {
  if (!hasGitRepo(directory)) {
    return null;
  }

  try {
    const res = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: directory,
      encoding: "utf8",
      timeout: 5000,
    });

    if (res.status !== 0) {
      return null;
    }

    return res.stdout.trim();
  } catch (e) {
    return null;
  }
}

// Создать новую ветку
export function createBranch(directory, branchName) {
  if (!hasGitRepo(directory)) {
    return { success: false, reason: "No git repo" };
  }

  try {
    const res = spawnSync("git", ["checkout", "-b", branchName], {
      cwd: directory,
      encoding: "utf8",
      timeout: 10000,
    });

    if (res.status !== 0) {
      return {
        success: false,
        reason: `git checkout -b failed: ${res.stderr}`,
      };
    }

    return { success: true, branch: branchName };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

// Получить последние N коммитов
export function gitLog(directory, count = 5) {
  if (!hasGitRepo(directory) || !hasGitCommits(directory)) {
    return { available: false, reason: "No git repo or no commits" };
  }

  try {
    const res = spawnSync("git", ["log", `--oneline`, `-${count}`], {
      cwd: directory,
      encoding: "utf8",
      timeout: 5000,
    });

    if (res.status !== 0) {
      return { available: false, reason: `git log failed: ${res.stderr}` };
    }

    const commits = res.stdout
      .trim()
      .split("\n")
      .map((line) => {
        const [hash, ...messageParts] = line.split(" ");
        return {
          hash: hash.trim(),
          message: messageParts.join(" ").trim(),
        };
      });

    return {
      available: true,
      commits,
      count: commits.length,
    };
  } catch (e) {
    return { available: false, reason: e.message };
  }
}

// Conventional commits парсер
// Автогенерация типа и scope из task_id и домена
export function parseConventionalCommit(taskId, summary, domain = null) {
  // Определяем тип из task_id
  let type = "feat";
  const taskType = taskId.split("-")[1]; // например, HEALTH, CLIENT, UTILS

  const typeMap = {
    TEST: "test",
    FIX: "fix",
    BUG: "fix",
    DOC: "docs",
    STYLE: "style",
    REFACTOR: "refactor",
    CHORE: "chore",
    PERF: "perf",
    CI: "ci",
  };

  if (taskType && typeMap[taskType]) {
    type = typeMap[taskType];
  }

  // Определяем scope из domain или task_id
  let scope = domain || taskType?.toLowerCase() || "general";
  scope = scope
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  // Формируем сообщение
  const subject = summary.length > 50 ? summary.slice(0, 50) + "..." : summary;
  const message = `${type}(${scope}): ${subject} [${taskId}]`;

  return {
    type,
    scope,
    subject,
    full_message: message,
    task_id: taskId,
  };
}

// Полный workflow: add + commit
export function gitAddAndCommit(
  directory,
  files,
  taskId,
  summary,
  domain = null,
  author = null,
) {
  const conventional = parseConventionalCommit(taskId, summary, domain);

  const addResult = gitAdd(directory, files);
  if (!addResult.success) {
    return { success: false, reason: `git add failed: ${addResult.reason}` };
  }

  const commitResult = gitCommit(directory, conventional.full_message, author);
  if (!commitResult.success) {
    return {
      success: false,
      reason: `git commit failed: ${commitResult.reason}`,
    };
  }

  return {
    success: true,
    commit_hash: commitResult.commit_hash,
    message: conventional.full_message,
    type: conventional.type,
    scope: conventional.scope,
    task_id: taskId,
    files_count: files.length,
  };
}
