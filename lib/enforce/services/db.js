import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { OPENC_DIR } from "../config.js";

export function initDatabase(directory) {
  const opencPath = join(directory, OPENC_DIR);
  if (!existsSync(opencPath)) {
    mkdirSync(opencPath, { recursive: true });
  }

  const dbPath = join(opencPath, "enforce.db");
  const db = new DatabaseSync(dbPath);

  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      task_id TEXT NOT NULL,
      current_session_id TEXT,
      phase TEXT NOT NULL CHECK(phase IN ('idle', 'tdd_red', 'tdd_green', 'implementing', 'validated', 'completed', 'aborted')),
      priority TEXT CHECK(priority IN ('low', 'medium', 'high')),
      baseline_sha TEXT NOT NULL,
      files_whitelist TEXT NOT NULL,
      test_files TEXT NOT NULL,
      validated INTEGER NOT NULL DEFAULT 0 CHECK(validated IN (0, 1)),
      session_tokens INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS test_runs (
      run_id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      exit_code INTEGER NOT NULL,
      error_digest TEXT,
      raw_log_path TEXT,
      duration_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  return db;
}

export function getState(db) {
  const row = db.prepare("SELECT * FROM task_state WHERE id = 1").get();
  if (!row) return null;
  return {
    ...row,
    files_whitelist: JSON.parse(row.files_whitelist),
    test_files: JSON.parse(row.test_files),
    validated: Boolean(row.validated),
  };
}

export function upsertState(db, state) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO task_state
      (id, task_id, current_session_id, phase, priority, baseline_sha, files_whitelist, test_files, validated, session_tokens, created_at, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    state.task_id,
    state.current_session_id ?? null,
    state.phase,
    state.priority ?? null,
    state.baseline_sha,
    JSON.stringify(state.files_whitelist || []),
    JSON.stringify(state.test_files || []),
    state.validated ? 1 : 0,
    state.session_tokens ?? 0,
    state.created_at || now,
    now,
  );
}

export function updatePhase(db, phase, extras = {}) {
  const sets = ["phase = ?", "updated_at = datetime('now')"];
  const params = [phase];
  if (extras.validated !== undefined) {
    sets.push("validated = ?");
    params.push(extras.validated ? 1 : 0);
  }
  if (extras.session_tokens !== undefined) {
    sets.push("session_tokens = ?");
    params.push(extras.session_tokens);
  }
  if (extras.current_session_id !== undefined) {
    sets.push("current_session_id = ?");
    params.push(extras.current_session_id);
  }
  db.prepare(`UPDATE task_state SET ${sets.join(", ")} WHERE id = 1`).run(...params);
}

export function recordTestRun(db, run) {
  db.prepare(`
    INSERT INTO test_runs (task_id, phase, exit_code, error_digest, raw_log_path, duration_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(run.task_id, run.phase, run.exit_code, run.error_digest ?? null, run.raw_log_path ?? null, run.duration_ms ?? 0);
}
