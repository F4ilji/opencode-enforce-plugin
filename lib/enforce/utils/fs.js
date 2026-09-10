import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { OPENC_DIR } from "../config.js";

export function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

export function readState(directory) {
  const p = join(directory, OPENC_DIR, "state.json");
  try {
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    /* corrupt state — start fresh */
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
    return false;
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
