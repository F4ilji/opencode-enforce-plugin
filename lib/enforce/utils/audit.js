import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { OPENC_DIR } from "../config.js";

export function logAudit(directory, event) {
  const auditPath = join(directory, OPENC_DIR, "enforce-audit.jsonl");
  const entry = { ts: new Date().toISOString(), ...event };
  try { appendFileSync(auditPath, JSON.stringify(entry) + "\n"); } catch (e) { /* ignore */ }
}

export function incrementMetric(directory, metric, value = 1, taskId = null, sessionId = null) {
  const metricsPath = join(directory, OPENC_DIR, "metrics.jsonl");
  const entry = { ts: new Date().toISOString(), metric, value, session_id: sessionId || "unknown", task_id: taskId || null };
  try { appendFileSync(metricsPath, JSON.stringify(entry) + "\n"); } catch (e) { /* ignore */ }
}
