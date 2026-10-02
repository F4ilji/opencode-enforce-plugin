import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const NODE_INTERNAL_FRAMES = /^\s*at\s+.*(?:\(node:internal|\/node_modules\/).*\n?/gm;
const ANSI_REGEX = /\x1B\[[0-9;]*[a-zA-Z]/g;

export function processExecutionLogs(directory, rawStdout, rawStderr, exitCode) {
  const fullOutput = (rawStdout + "\n" + rawStderr).replace(ANSI_REGEX, "");

  const logDir = join(directory, ".log");
  mkdirSync(logDir, { recursive: true });
  const rawLogPath = join(logDir, "last_test.log");
  writeFileSync(rawLogPath, fullOutput, "utf8");

  if (exitCode === 0) {
    return { passed: true, digest: "ALL_TESTS_PASSING", rawLogPath };
  }

  const stripped = fullOutput.replace(NODE_INTERNAL_FRAMES, "");
  const lines = stripped.split("\n");
  const digestLines = [];
  let capturing = false;

  for (const line of lines) {
    if (/^\s*(✔|PASS|ok|\+)/.test(line)) continue;
    if (/FAIL|Error:|AssertionError|✕|expected.*to/i.test(line)) {
      capturing = true;
    }
    if (capturing) {
      digestLines.push(line);
      if (digestLines.length >= 20) break;
    }
  }

  const digest = digestLines.length > 0
    ? digestLines.join("\n").trim()
    : lines.slice(-15).join("\n").trim();

  return {
    passed: false,
    digest: `[FAILURE DIGEST]\n${digest}\n\n(Full raw log: .log/last_test.log)`,
    rawLogPath,
  };
}
