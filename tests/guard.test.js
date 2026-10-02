import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { enforcePreExecutionPolicy } from "../lib/enforce/services/guard.js";
import { initDatabase, upsertState } from "../lib/enforce/services/db.js";

let dir;
let db;

function seedState(phase) {
  upsertState(db, {
    task_id: "TASK-01",
    phase,
    baseline_sha: "abc123",
    files_whitelist: ["src/impl.js"],
    test_files: ["tests/impl.test.js"],
    validated: false,
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "enforce-guard-"));
  db = initDatabase(dir);
});

afterEach(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});

test("non-mutating tools pass through", () => {
  seedState("idle");
  enforcePreExecutionPolicy("read", { filePath: "src/impl.js" }, dir, db);
});

test("no active task blocks mutation", () => {
  assert.throws(
    () => enforcePreExecutionPolicy("edit", { filePath: "src/impl.js" }, dir, db),
    /нет активной задачи/i,
  );
});

test("tdd_red blocks impl file edits with TDD_RED_VIOLATION", () => {
  seedState("tdd_red");
  assert.throws(
    () => enforcePreExecutionPolicy("edit", { filePath: "src/impl.js" }, dir, db),
    /TDD_RED_VIOLATION/,
  );
});

test("tdd_red allows test file edits", () => {
  seedState("tdd_red");
  enforcePreExecutionPolicy("edit", { filePath: "tests/impl.test.js" }, dir, db);
});

test("tdd_green blocks test file edits with TEST_LOCK_VIOLATION", () => {
  seedState("tdd_green");
  assert.throws(
    () => enforcePreExecutionPolicy("edit", { filePath: "tests/impl.test.js" }, dir, db),
    /TEST_LOCK_VIOLATION/,
  );
});

test("tdd_green allows impl file edits", () => {
  seedState("tdd_green");
  enforcePreExecutionPolicy("edit", { filePath: "src/impl.js" }, dir, db);
});

test("validated blocks test edits and out-of-scope files", () => {
  seedState("validated");
  assert.throws(
    () => enforcePreExecutionPolicy("edit", { filePath: "tests/impl.test.js" }, dir, db),
    /TEST_LOCK_VIOLATION/,
  );
  assert.throws(
    () => enforcePreExecutionPolicy("edit", { filePath: "src/other.js" }, dir, db),
    /SCOPE_CREEP/,
  );
});

test("idle phase blocks all mutations", () => {
  seedState("idle");
  assert.throws(
    () => enforcePreExecutionPolicy("edit", { filePath: "src/impl.js" }, dir, db),
    /нет активной задачи/i,
  );
});
