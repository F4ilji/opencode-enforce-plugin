import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { processExecutionLogs } from "../lib/enforce/utils/reducer.js";

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "enforce-reducer-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("exit 0 returns passed=true and ALL_TESTS_PASSING", () => {
  const res = processExecutionLogs(dir, "ok 1 - test\n", "", 0);
  assert.equal(res.passed, true);
  assert.equal(res.digest, "ALL_TESTS_PASSING");
});

test("writes raw log to .log/last_test.log", () => {
  processExecutionLogs(dir, "stdout content\n", "stderr content\n", 1);
  const logPath = join(dir, ".log", "last_test.log");
  assert.ok(existsSync(logPath));
  const content = readFileSync(logPath, "utf8");
  assert.ok(content.includes("stdout content"));
  assert.ok(content.includes("stderr content"));
});

test("failure strips node:internal frames from digest", () => {
  const raw = "FAIL tests/a.test.js\nAssertionError: expected 1 to equal 2\n    at Test.<anonymous> (node:internal/test_runner:123:5)\n    at processTicksAndRejections (node:internal/process/task_queues:95:5)\n";
  const res = processExecutionLogs(dir, raw, "", 1);
  assert.equal(res.passed, false);
  assert.ok(!res.digest.includes("node:internal"));
  assert.ok(res.digest.includes("AssertionError"));
});

test("failure skips PASS lines in digest", () => {
  const raw = "PASS tests/b.test.js\nFAIL tests/a.test.js\nAssertionError: boom\n";
  const res = processExecutionLogs(dir, raw, "", 1);
  assert.ok(!res.digest.includes("PASS tests/b.test.js"));
  assert.ok(res.digest.includes("AssertionError"));
});

test("digest includes pointer to raw log path", () => {
  const res = processExecutionLogs(dir, "FAIL\nError: x\n", "", 1);
  assert.ok(res.digest.includes(".log/last_test.log"));
});

test("strips ANSI escape codes", () => {
  const raw = "\x1b[31mFAIL\x1b[39m tests/a.test.js\nError: boom\n";
  const res = processExecutionLogs(dir, raw, "", 1);
  assert.ok(!res.digest.includes("\x1b["));
});
