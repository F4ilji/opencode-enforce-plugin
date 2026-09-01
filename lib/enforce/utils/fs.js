import {
  appendFileSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
} from "node:fs";
import { join, dirname } from "node:path";
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
    logAudit(directory, { event: "state_read_failed", error: String(e.message ?? e) });
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
    logAudit(directory, { event: "tech_debt_read_failed", error: String(e.message ?? e) });
  }
  return {};
}

export function writeTechDebt(directory, debt) {
  try {
    const target = join(directory, OPENC_DIR, "tech_debt.json");
    const tmp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
    writeFileSync(tmp, JSON.stringify(debt, null, 2));
    renameSync(tmp, target);
  } catch (e) {
    logAudit(directory, { event: "tech_debt_write_failed", error: String(e.message ?? e) });
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
    logAudit(dirname(filePath).includes(OPENC_DIR) ? dirname(filePath) : dirname(dirname(filePath)),
      { event: "file_write_failed", path: filePath, error: String(e.message ?? e) });
    return false;
  }
}

export function appendToFile(filePath, line) {
  try {
    appendFileSync(filePath, line);
    return true;
  } catch (e) {
    logAudit(dirname(filePath).includes(OPENC_DIR) ? dirname(filePath) : dirname(dirname(filePath)),
      { event: "file_append_failed", path: filePath, error: String(e.message ?? e) });
    return false;
  }
}
