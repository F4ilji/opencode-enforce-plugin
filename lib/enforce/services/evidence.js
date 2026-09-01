import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { OPENC_DIR } from "../config.js";
import { ensureDir } from "../utils/fs.js";

// Проверяет, есть ли git репозиторий и есть ли хотя бы один коммит
export function hasGitRepo(directory) {
  const res = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: directory,
    encoding: "utf8",
    timeout: 5000
  });
  return res.status === 0 && res.stdout.trim() === "true";
}

export function hasGitCommits(directory) {
  const res = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: directory,
    encoding: "utf8",
    timeout: 5000
  });
  return res.status === 0 && res.stdout.trim().length === 40;
}

// Собирает git diff --stat для changed files
export function getGitDiffStat(directory, files = []) {
  if (!hasGitRepo(directory) || !hasGitCommits(directory)) {
    return { available: false, reason: "No git repo or no commits" };
  }

  try {
    const args = ["diff", "--stat", "HEAD"];
    if (files.length > 0) {
      args.push("--", ...files);
    }
    const res = spawnSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      timeout: 10000
    });

    if (res.status !== 0) {
      return { available: false, reason: `git diff failed: ${res.stderr}` };
    }

    return {
      available: true,
      stat: res.stdout.trim(),
      files_count: files.length
    };
  } catch (e) {
    return { available: false, reason: e.message };
  }
}

// Собирает полный git diff для changed files
export function getGitDiff(directory, files = []) {
  if (!hasGitRepo(directory) || !hasGitCommits(directory)) {
    return { available: false, reason: "No git repo or no commits" };
  }

  try {
    const args = ["diff", "HEAD"];
    if (files.length > 0) {
      args.push("--", ...files);
    }
    const res = spawnSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024
    });

    if (res.status !== 0) {
      return { available: false, reason: `git diff failed: ${res.stderr}` };
    }

    return {
      available: true,
      diff: res.stdout,
      files_count: files.length,
      size_bytes: res.stdout.length
    };
  } catch (e) {
    return { available: false, reason: e.message };
  }
}

// Сохраняет артефакт в .opencode/artifacts/<sessionId>/
export function saveArtifact(directory, sessionId, name, data) {
  const artifactsDir = join(directory, OPENC_DIR, "artifacts", sessionId);
  ensureDir(artifactsDir);
  const path = join(artifactsDir, `${name}.json`);
  writeFileSync(path, JSON.stringify(data, null, 2));
  return path;
}

// Читает артефакт
export function readArtifact(directory, sessionId, name) {
  const path = join(directory, OPENC_DIR, "artifacts", sessionId, `${name}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return null;
  }
}

// Собирает полный evidence пакет для receipt
export function gatherEvidence(directory, sessionId, changedFiles, preflightResult, criticResult = null, healthcheckResult = null) {
  const evidence = {
    collected_at: new Date().toISOString(),
    session_id: sessionId,
    changed_files: changedFiles,
    git: getGitDiffStat(directory, changedFiles),
    preflight: preflightResult,
    critic: criticResult,
    healthcheck: healthcheckResult
  };

  // Сохраняем в artifacts
  if (sessionId) {
    saveArtifact(directory, sessionId, "evidence", evidence);
  }

  return evidence;
}
