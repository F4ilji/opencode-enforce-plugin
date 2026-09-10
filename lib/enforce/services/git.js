import { spawnSync } from "node:child_process";
import { hasGitRepo, hasGitCommits } from "./evidence.js";

export function gitStatus(directory) {
  if (!hasGitRepo(directory)) return { available: false, reason: "No git repo" };
  try {
    const res = spawnSync("git", ["status", "--porcelain"], {
      cwd: directory,
      encoding: "utf8",
      timeout: 5000,
    });
    if (res.status !== 0) return { available: false, reason: `git status failed: ${res.stderr}` };
    const lines = res.stdout.trim().split("\n").filter((l) => l.trim());
    return {
      available: true,
      modified: lines.filter((l) => l.startsWith(" M") || l.startsWith("M ")).map((l) => l.slice(3).trim()),
      untracked: lines.filter((l) => l.startsWith("??")).map((l) => l.slice(3).trim()),
      has_changes: lines.length > 0,
    };
  } catch (e) {
    return { available: false, reason: e.message };
  }
}

export function gitAdd(directory, files = []) {
  if (!hasGitRepo(directory)) return { success: false, reason: "No git repo" };
  try {
    const args = ["add", "--", ...files];
    const res = spawnSync("git", args, { cwd: directory, encoding: "utf8", timeout: 10000 });
    if (res.status !== 0) return { success: false, reason: `git add failed: ${res.stderr}` };
    return { success: true, files_added: files.length };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

export function gitCommit(directory, message) {
  if (!hasGitRepo(directory)) return { success: false, reason: "No git repo" };
  try {
    const res = spawnSync("git", ["commit", "-m", message], {
      cwd: directory,
      encoding: "utf8",
      timeout: 10000,
    });
    if (res.status !== 0) return { success: false, reason: `git commit failed: ${res.stderr}` };
    const hashRes = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: directory,
      encoding: "utf8",
      timeout: 5000,
    });
    return { success: true, commit_hash: hashRes.status === 0 ? hashRes.stdout.trim() : null, message };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

export function gitResetHard(directory, sha) {
  if (!hasGitRepo(directory)) return { success: false, reason: "No git repo" };
  try {
    const res = spawnSync("git", ["reset", "--hard", sha], {
      cwd: directory,
      encoding: "utf8",
      timeout: 10000,
    });
    if (res.status !== 0) return { success: false, reason: `git reset failed: ${res.stderr}` };
    return { success: true };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

export function gitClean(directory) {
  if (!hasGitRepo(directory)) return { success: false, reason: "No git repo" };
  try {
    const res = spawnSync("git", ["clean", "-fd", "-e", ".opencode"], {
      cwd: directory,
      encoding: "utf8",
      timeout: 10000,
    });
    if (res.status !== 0) return { success: false, reason: `git clean failed: ${res.stderr}` };
    return { success: true };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}
