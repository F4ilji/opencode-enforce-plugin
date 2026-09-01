import {
  appendFileSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { OPENC_DIR } from "../config.js";
import { logAudit } from "./audit.js";

export function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

export function readState(directory) {
  const p = join(directory, OPENC_DIR, "state.json");
  try {
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    /* ignore */
  }
  return {};
}

export function writeState(directory, state) {
  try {
    const target = join(directory, OPENC_DIR, "state.json");
    const tmp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, target);
    return true;
  } catch (e) {
    // v11.4: critical write — audit loudly, never swallow silently
    logAudit(directory, {
      event: "state_write_failed",
      error: String(e.message ?? e),
    });
    return false;
  }
}

export function readTechDebt(directory) {
  const p = join(directory, OPENC_DIR, "tech_debt.json");
  try {
    if (existsSync(p)) {
      const obj = JSON.parse(readFileSync(p, "utf8"));
      if (obj && typeof obj === "object") return obj;
    }
  } catch (e) {
    /* ignore */
  }
  return {};
}

export function writeTechDebt(directory, debt) {
  try {
    writeFileSync(
      join(directory, OPENC_DIR, "tech_debt.json"),
      JSON.stringify(debt, null, 2),
    );
  } catch (e) {
    /* ignore */
  }
}

export function readFileContent(filePath) {
  try {
    if (existsSync(filePath)) {
      return readFileSync(filePath, "utf8");
    }
  } catch (e) {
    /* ignore */
  }
  return null;
}

export function writeFileContent(filePath, content) {
  try {
    writeFileSync(filePath, content);
    return true;
  } catch (e) {
    return false;
  }
}

export function appendToFile(filePath, line) {
  try {
    appendFileSync(filePath, line);
    return true;
  } catch (e) {
    return false;
  }
}
