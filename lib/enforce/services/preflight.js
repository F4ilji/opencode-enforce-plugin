import { getConfig } from "../config.js";
import { shQuote } from "../utils/strings.js";
import { execFileAsync } from "../utils/exec.js";
import { processExecutionLogs } from "../utils/reducer.js";

export function isControlPlaneFile(relPath, directory) {
  const cfg = getConfig(directory);
  return cfg.controlPlaneFilesCompiled.some((re) => re.test(relPath));
}

async function runCmd(cmd, timeoutMs = 60000, cwd = process.cwd()) {
  return await execFileAsync("sh", ["-c", cmd], {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    cwd,
  });
}

export async function runPreflight(directory, batch = []) {
  const cfg = getConfig(directory);
  const steps = [];
  const started = Date.now();

  const compileCmd = cfg.preflight.compileall_cmd;
  if (!compileCmd || compileCmd.trim() === "") {
    steps.push({ name: "compileall", status: "skipped", reason: "compileall_cmd not configured" });
  } else {
    const res = await runCmd(compileCmd, cfg.preflight.timeouts.compileall, directory);
    if (res.error?.code === "ETIMEDOUT") {
      return { passed: false, step: "compileall", kind: "infra", output: `Timed out after ${cfg.preflight.timeouts.compileall / 1000}s`, steps, duration_ms: Date.now() - started };
    }
    if (res.status === 127) {
      steps.push({ name: "compileall", status: "skipped", reason: "compiler not available" });
    } else if (res.status !== 0) {
      const reduced = processExecutionLogs(directory, res.stdout || "", res.stderr || "", res.status);
      return { passed: false, step: "compileall", kind: "code", output: reduced.digest, rawLogPath: reduced.rawLogPath, steps, duration_ms: Date.now() - started };
    } else {
      steps.push({ name: "compileall", status: "pass" });
    }
  }

  const linterCmd = cfg.preflight.linter_cmd;
  if (!linterCmd || linterCmd.trim() === "") {
    steps.push({ name: "linter", status: "skipped", reason: "linter_cmd not configured" });
  } else {
    const lintableFiles = batch.filter((f) => {
      const ext = f.split(".").pop()?.toLowerCase();
      return ext && ["py", "js", "ts", "tsx", "jsx", "go", "rs", "java", "rb", "php", "c", "cpp", "h"].includes(ext);
    });

    if (lintableFiles.length === 0) {
      steps.push({ name: "linter", status: "skipped", reason: "no lintable files in batch" });
    } else {
      let hasError = false;
      let errorOutput = "";
      for (const f of lintableFiles) {
        const cmd = linterCmd.replace("{file}", shQuote(f));
        const res = await runCmd(cmd, cfg.preflight.timeouts.linter, directory);
        if (res.error?.code === "ETIMEDOUT") {
          return { passed: false, step: "linter", kind: "infra", output: `Timed out after ${cfg.preflight.timeouts.linter / 1000}s`, steps, duration_ms: Date.now() - started };
        }
        if (res.status === 127) {
          steps.push({ name: "linter", status: "skipped", reason: "linter not installed" });
          hasError = false;
          break;
        }
        if (res.status !== 0) {
          hasError = true;
          errorOutput = (res.stdout || "") + (res.stderr || "");
          break;
        }
      }
      if (hasError) {
        const reduced = processExecutionLogs(directory, errorOutput, "", 1);
        return { passed: false, step: "linter", kind: "code", output: reduced.digest, rawLogPath: reduced.rawLogPath, steps, duration_ms: Date.now() - started };
      }
      if (!steps.find((s) => s.name === "linter")) {
        steps.push({ name: "linter", status: "pass" });
      }
    }
  }

  const testCmd = cfg.preflight.test_cmd;
  if (!testCmd || testCmd.trim() === "") {
    steps.push({ name: "test", status: "skipped", reason: "test_cmd not configured" });
  } else {
    const res = await runCmd(testCmd, cfg.preflight.timeouts.test, directory);
    if (res.error?.code === "ETIMEDOUT") {
      return { passed: false, step: "test", kind: "infra", output: `Timed out after ${cfg.preflight.timeouts.test / 1000}s`, steps, duration_ms: Date.now() - started };
    }
    if (res.status === 127) {
      steps.push({ name: "test", status: "skipped", reason: "test tool not available" });
    } else if (res.status === 4 || res.status === 5) {
      steps.push({ name: "test", status: "skipped", reason: `exit ${res.status} (no tests yet)` });
    } else if (res.status !== 0) {
      const reduced = processExecutionLogs(directory, res.stdout || "", res.stderr || "", res.status);
      return { passed: false, step: "test", kind: "code", output: reduced.digest, rawLogPath: reduced.rawLogPath, steps, duration_ms: Date.now() - started };
    } else {
      steps.push({ name: "test", status: "pass" });
    }
  }

  return { passed: true, steps, duration_ms: Date.now() - started };
}
