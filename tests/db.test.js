import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initDatabase, getState, upsertState, updatePhase } from "../lib/enforce/services/db.js";

let dir;
let db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "enforce-db-"));
  db = initDatabase(dir);
});

afterEach(() => {
  try { db.close(); } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true });
});

test("initDatabase creates enforce.db in .opencode", () => {
  assert.ok(existsSync(join(dir, ".opencode", "enforce.db")));
});

test("initDatabase sets WAL mode", () => {
  const row = db.prepare("PRAGMA journal_mode").get();
  assert.equal(row.journal_mode, "wal");
});

test("getState returns null when no task", () => {
  assert.equal(getState(db), null);
});

test("upsertState + getState roundtrip", () => {
  upsertState(db, {
    task_id: "TASK-01",
    phase: "tdd_red",
    baseline_sha: "abc123",
    files_whitelist: ["src/a.js"],
    test_files: ["tests/a.test.js"],
    validated: false,
  });
  const state = getState(db);
  assert.equal(state.task_id, "TASK-01");
  assert.equal(state.phase, "tdd_red");
  assert.deepEqual(state.files_whitelist, ["src/a.js"]);
  assert.deepEqual(state.test_files, ["tests/a.test.js"]);
  assert.equal(state.validated, false);
});

test("updatePhase transitions tdd_red → tdd_green", () => {
  upsertState(db, {
    task_id: "TASK-01",
    phase: "tdd_red",
    baseline_sha: "abc",
    files_whitelist: ["a.js"],
    test_files: ["a.test.js"],
  });
  updatePhase(db, "tdd_green", { validated: false });
  assert.equal(getState(db).phase, "tdd_green");
});

test("updatePhase sets validated flag", () => {
  upsertState(db, {
    task_id: "TASK-01",
    phase: "tdd_green",
    baseline_sha: "abc",
    files_whitelist: ["a.js"],
    test_files: ["a.test.js"],
  });
  updatePhase(db, "validated", { validated: true });
  const state = getState(db);
  assert.equal(state.phase, "validated");
  assert.equal(state.validated, true);
});

test("initDatabase is idempotent", () => {
  db.close();
  const db2 = initDatabase(dir);
  assert.ok(db2);
  db2.close();
  db = initDatabase(dir);
});
