import { spawnSync } from "node:child_process";
import { getConfig } from "../config.js";
import { readTechDebt, writeTechDebt } from "../utils/fs.js";
import { logAudit } from "../utils/audit.js";
import { shQuote, toContainerPath } from "../utils/strings.js";

export function isControlPlaneFile(relPath, directory) {
  const cfg = getConfig(directory);
  return cfg.controlPlaneFilesCompiled.some(re => re.test(relPath));
}

export function isServiceFile(relPath, directory) {
  const cfg = getConfig(directory);
  return cfg.serviceFileCompiled.some(re => re.test(relPath));
}

export function serviceFor(relPath, directory) {
  const cfg = getConfig(directory);
  for (const { pattern, service } of cfg.serviceRulesCompiled) {
    if (pattern.test(relPath)) return service;
  }
  return null;
}

export function runInContainer(
  directory,
  innerCmd,
  timeoutMs = 60000,
  input = undefined,
) {
  const cfg = getConfig(directory);
  try {
    const opts = { cwd: directory, encoding: "utf8", timeout: timeoutMs };
    if (input !== undefined) opts.input = input;
    return spawnSync(
      "docker",
      ["compose", "exec", "-T", cfg.service, "sh", "-c", innerCmd],
      opts,
    );
  } catch (e) {
    return { status: -1, stdout: "", stderr: String(e.message ?? e), error: e };
  }
}

function isDockerInfraError(res) {
  if (res.error && res.error.code === "ENOENT") return true;
  const err = (res.stderr || "") + (res.stdout || "");
  return /Cannot connect to the Docker daemon|is the docker daemon running|no such service|is not running|No such container|Cannot start service/i.test(
    err,
  );
}

function infraFailure(res, timeoutMs) {
  if (res.error) {
    if (res.error.code === "ETIMEDOUT") {
      return {
        kind: "code",
        output: `Step timed out after ${Math.round(timeoutMs / 1000)}s`,
      };
    }
    return {
      kind: "infra",
      output: `Docker infrastructure unavailable: ${res.error.message}`,
    };
  }
  if (isDockerInfraError(res)) {
    return {
      kind: "infra",
      output: `Docker infrastructure unavailable. Run: docker compose up -d\n${(res.stderr || "") + (res.stdout || "")}`,
    };
  }
  return null;
}

function parseLinterJson(stdout) {
  try {
    const arr = JSON.parse(stdout);
    return Array.isArray(arr) ? arr : null;
  } catch (e) {
    return null;
  }
}

function updateTechDebt(directory, touchedFiles, obsByFile) {
  const debt = readTechDebt(directory);
  const now = new Date().toISOString();
  for (const f of touchedFiles) {
    for (const key of Object.keys(debt)) {
      if (debt[key].file === f) delete debt[key];
    }
    for (const v of obsByFile.get(f) || []) {
      const key = `${f}:${v.line}:${v.code}`;
      const prev = debt[key];
      debt[key] = {
        file: f,
        line: v.line,
        code: v.code,
        message: v.message,
        first_seen: prev ? prev.first_seen : now,
        last_seen: now,
        count: (prev ? prev.count : 0) + 1,
      };
    }
  }
  writeTechDebt(directory, debt);
  return Object.keys(debt).length;
}

export async function runPreflight(directory, batch = []) {
  const cfg = getConfig(directory);
  const steps = [];
  {
    const res = runInContainer(
      directory,
      cfg.preflight.compileall_cmd,
      cfg.preflight.timeouts.compileall,
    );
    const infra = infraFailure(res, cfg.preflight.timeouts.compileall);
    if (infra)
      return {
        passed: false,
        step: "compileall",
        kind: infra.kind,
        output: infra.output,
        steps,
      };
    if (res.status === 127) {
      steps.push({
        name: "compileall",
        status: "skipped",
        reason: "compiler not available in container",
      });
    } else if (res.status !== 0) {
      return {
        passed: false,
        step: "compileall",
        kind: "code",
        output: (res.stdout || "") + (res.stderr || ""),
        steps,
      };
    } else {
      steps.push({ name: "compileall", status: "pass" });
    }
  }

  const containerFiles = [
    ...new Set(
      batch.map(f => toContainerPath(f, directory)).filter(Boolean),
    ),
  ];

  const lintableFiles = containerFiles.filter(f => {
    const ext = f.split(".").pop()?.toLowerCase();
    return ext && ["py", "js", "ts", "tsx", "jsx", "go", "rs", "java", "rb", "php", "c", "cpp", "h"].includes(ext);
  });

  if (lintableFiles.length === 0) {
    steps.push({
      name: "linter",
      status: "skipped",
      reason: "no lintable files in change batch",
    });
  } else {
    let linterMissing = false;
    const touched = [];
    const obsByFile = new Map();
    let observed = 0;
    for (const c of lintableFiles) {
      const cmd = cfg.preflight.linter_cmd.replace("{file}", shQuote(c));
      const res = runInContainer(
        directory,
        cmd,
        cfg.preflight.timeouts.ruff,
      );
      const infra = infraFailure(res, cfg.preflight.timeouts.ruff);
      if (infra)
        return {
          passed: false,
          step: "linter",
          kind: infra.kind,
          output: infra.output,
          steps,
        };
      if (res.status === 127) {
        linterMissing = true;
        break;
      }
      const json = parseLinterJson(res.stdout || "");
      if (json === null) continue;
      touched.push(c);
      const obs = json.map((v) => ({
        code: v.code || v.rule || "?",
        message: v.message || "",
        line: (v.location && v.location.row) || v.line || 0,
      }));
      obsByFile.set(c, obs);
      observed += obs.length;
    }
    if (linterMissing) {
      steps.push({
        name: "linter",
        status: "skipped",
        reason: "tool not installed in container",
      });
    } else {
      const totalDebt = updateTechDebt(directory, touched, obsByFile);
      steps.push({ name: "linter", status: "pass", observed, totalDebt });
      logAudit(directory, { event: "tech_debt_updated", observed, totalDebt });
    }
  }

  if (cfg.preflight.test_cmd) {
    const res = runInContainer(
      directory,
      cfg.preflight.test_cmd,
      cfg.preflight.timeouts.pytest,
    );
    const infra = infraFailure(res, cfg.preflight.timeouts.pytest);
    if (infra)
      return {
        passed: false,
        step: "test",
        kind: infra.kind,
        output: infra.output,
        steps,
      };
    if (res.status === 127) {
      steps.push({
        name: "test",
        status: "skipped",
        reason: "tool not installed in container",
      });
    } else if (res.status === 4 || res.status === 5) {
      steps.push({
        name: "test",
        status: "skipped",
        reason: `exit ${res.status} (no tests yet)`,
      });
    } else if (res.status !== 0) {
      return {
        passed: false,
        step: "test",
        kind: "code",
        output: (res.stdout || "") + (res.stderr || ""),
        steps,
      };
    } else {
      steps.push({ name: "test", status: "pass" });
    }
  }

  return { passed: true, steps };
}

export async function waitForHealth(directory, service, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const idRes = spawnSync("docker", ["compose", "ps", "-q", service], {
        cwd: directory,
        encoding: "utf8",
        timeout: 5000,
      });
      const cid = (idRes.stdout || "").trim().split("\n").filter(Boolean)[0];
      if (cid) {
        const res = spawnSync(
          "docker",
          ["inspect", "--format={{.State.Health.Status}}", cid],
          {
            cwd: directory,
            encoding: "utf8",
            timeout: 5000,
          },
        );
        if (res.status === 0) {
          const status = res.stdout.trim();
          if (status === "healthy") return { healthy: true };
          if (status === "unhealthy") return { healthy: false, status };
          if (status === "") return { healthy: true, assumed: true };
        }
      }
    } catch (e) {
      /* ignore and retry */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { healthy: false, status: "timeout" };
}
