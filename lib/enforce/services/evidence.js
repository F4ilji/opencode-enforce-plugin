import { spawnSync } from "node:child_process";

export function hasGitRepo(directory) {
  const res = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: directory,
    encoding: "utf8",
    timeout: 5000,
  });
  return res.status === 0 && res.stdout.trim() === "true";
}

export function hasGitCommits(directory) {
  const res = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: directory,
    encoding: "utf8",
    timeout: 5000,
  });
  return res.status === 0 && res.stdout.trim().length === 40;
}

export function getGitDiff(directory, files = []) {
  if (!hasGitRepo(directory) || !hasGitCommits(directory)) {
    return { available: false, reason: "No git repo or no commits" };
  }
  try {
    const args = ["diff", "HEAD"];
    if (files.length > 0) args.push("--", ...files);
    const res = spawnSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (res.status !== 0) return { available: false, reason: `git diff failed: ${res.stderr}` };
    return { available: true, diff: res.stdout, files_count: files.length, size_bytes: res.stdout.length };
  } catch (e) {
    return { available: false, reason: e.message };
  }
}

export function getGitDiffStat(directory, files = []) {
  if (!hasGitRepo(directory) || !hasGitCommits(directory)) {
    return { available: false, reason: "No git repo or no commits" };
  }
  try {
    const args = ["diff", "--stat", "HEAD"];
    if (files.length > 0) args.push("--", ...files);
    const res = spawnSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      timeout: 10000,
    });
    if (res.status !== 0) return { available: false, reason: `git diff failed: ${res.stderr}` };
    return { available: true, stat: res.stdout.trim(), files_count: files.length };
  } catch (e) {
    return { available: false, reason: e.message };
  }
}

export function getHeadSha(directory) {
  const res = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: directory,
    encoding: "utf8",
    timeout: 5000,
  });
  return res.status === 0 ? res.stdout.trim() : null;
}
