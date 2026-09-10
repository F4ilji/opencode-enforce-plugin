import { getConfig } from "../config.js";
import { shQuote } from "../utils/strings.js";
import { execFileAsync } from "../utils/exec.js";

export function isControlPlaneFile(relPath, directory) {
  const cfg = getConfig(directory);
  return cfg.controlPlaneFilesCompiled.some((re) => re.test(relPath));
}

async function runCmd(cmd, timeoutMs = 60000) {
  return await execFileAsync("sh", ["-c", cmd], {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });
}

export async function runPreflight(directory, batch = []) {
  const cfg = getConfig(directory);
  const steps = [];

  // Step 1: compileall
  const compileCmd = cfg.preflight.compileall_cmd;
  if (!compileCmd || compileCmd.trim() === "") {
    steps.push({ name: "compileall", status: "skipped", reason: "compileall_cmd not configured" });
  } else {
    const res = await runCmd(compileCmd, cfg.preflight.timeouts.compileall);
    if (res.error?.code === "ETIMEDOUT") {
      return { passed: false, step: "compileall", kind: "infra", output: `Timed out after ${cfg.preflight.timeouts.compileall / 1000}s`, steps };
    }
    if (res.status === 127) {
      steps.push({ name: "compileall", status: "skipped", reason: "compiler not available" });
    } else if (res.status !== 0) {
      return { passed: false, step: "compileall", kind: "code", output: (res.stdout || "") + (res.stderr || ""), steps };
    } else {
      steps.push({ name: "compileall", status: "pass" });
    }
  }

  // Step 2: linter
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
        const res = await runCmd(cmd, cfg.preflight.timeouts.linter);
        if (res.error?.code === "ETIMEDOUT") {
          return { passed: false, step: "linter", kind: "infra", output: `Timed out after ${cfg.preflight.timeouts.linter / 1000}s`, steps };
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
        return { passed: false, step: "linter", kind: "code", output: errorOutput, steps };
      }
      if (!steps.find((s) => s.name === "linter")) {
        steps.push({ name: "linter", status: "pass" });
      }
    }
  }

  // Step 3: test
  const testCmd = cfg.preflight.test_cmd;
  if (!testCmd || testCmd.trim() === "") {
    steps.push({ name: "test", status: "skipped", reason: "test_cmd not configured" });
  } else {
    const res = await runCmd(testCmd, cfg.preflight.timeouts.test);
    if (res.error?.code === "ETIMEDOUT") {
      return { passed: false, step: "test", kind: "infra", output: `Timed out after ${cfg.preflight.timeouts.test / 1000}s`, steps };
    }
    if (res.status === 127) {
      steps.push({ name: "test", status: "skipped", reason: "test tool not available" });
    } else if (res.status === 4 || res.status === 5) {
      steps.push({ name: "test", status: "skipped", reason: `exit ${res.status} (no tests yet)` });
    } else if (res.status !== 0) {
      return { passed: false, step: "test", kind: "code", output: (res.stdout || "") + (res.stderr || ""), steps };
    } else {
      steps.push({ name: "test", status: "pass" });
    }
  }

  return { passed: true, steps };
}
