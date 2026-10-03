import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function read(p) {
  return readFileSync(join(root, p), "utf8");
}

test("db.js uses node:sqlite", () => {
  const src = read("lib/enforce/services/db.js");
  assert.ok(src.includes('from "node:sqlite"'));
  assert.ok(!src.includes("better-sqlite3"));
});

test("reducer.js exists with processExecutionLogs", () => {
  const src = read("lib/enforce/utils/reducer.js");
  assert.ok(src.includes("processExecutionLogs"));
});

test("token_guard.js exists", () => {
  assert.ok(existsSync(join(root, "lib/enforce/services/token_guard.js")));
});

test("task.js exports exactly 4 tools", () => {
  const src = read("lib/enforce/tools/task.js");
  assert.ok(src.includes("taskStartTool"));
  assert.ok(src.includes("taskVerifyTool"));
  assert.ok(src.includes("taskCommitTool"));
  assert.ok(src.includes("taskRollbackTool"));
  assert.ok(!src.includes("createPlanTool"));
  assert.ok(!src.includes("waiveReviewTool"));
});

test("index.js registers 4 tool names", () => {
  const src = read("lib/enforce/index.js");
  assert.ok(src.includes("task_start:"));
  assert.ok(src.includes("task_verify:"));
  assert.ok(src.includes("task_commit:"));
  assert.ok(src.includes("task_rollback:"));
});

test("critic.js and fs.js deleted", () => {
  assert.ok(!existsSync(join(root, "lib/enforce/services/critic.js")));
  assert.ok(!existsSync(join(root, "lib/enforce/utils/fs.js")));
});

test("config.js has no ROUTERAI refs", () => {
  const src = read("lib/enforce/config.js");
  assert.ok(!src.includes("ROUTERAI"));
  assert.ok(!src.includes("critic_system_prompt"));
});

test("index.js wires db and 4 tools", () => {
  const src = read("lib/enforce/index.js");
  assert.ok(src.includes("initDatabase"));
  assert.ok(src.includes("task_start"));
  assert.ok(!src.includes("loadRouterConfig"));
});

test("git.js filters gitignored files in gitAdd", () => {
  const src = read("lib/enforce/services/git.js");
  assert.ok(src.includes("check-ignore"));
  assert.ok(src.includes("ignoredFiles"));
  assert.ok(src.includes("stageableFiles"));
});
