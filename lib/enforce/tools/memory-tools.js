import { appendFileSync, writeFileSync, existsSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { OPENC_DIR, getConfig } from "../config.js";
import { readState } from "../utils/fs.js";
import { logAudit, incrementMetric } from "../utils/audit.js";
import { findDuplicateFact, detectContradiction } from "../services/memory.js";
import { regenerateMemoryMd } from "../services/migration.js";

export function memoryAddTool(context) {
  return {
    description: "Add a fact to structured memory with deduplication. Always pass task_id when closing a task.",
    args: {
      domain: { type: "string" },
      fact: { type: "string" },
      implication: { type: "string" },
      evidence: { type: "string" },
      confidence: { type: "number" },
      task_id: { type: "string", optional: true },
    },
    async execute(args) {
      const { domain, fact, implication, evidence, confidence } = args;
      const { directory, sessionId } = context;

      const cfg = getConfig(directory);
      if (!cfg.memory_domains.includes(domain)) {
        return { status: "error", reason: `Invalid domain. Must be one of: ${cfg.memory_domains.join(", ")}` };
      }

      if (confidence < 0 || confidence > 1) {
        return { status: "error", reason: "Confidence must be between 0 and 1" };
      }

      const newFact = { domain, fact, implication, evidence, confidence };

      const duplicate = findDuplicateFact(directory, newFact);
      if (duplicate) {
        incrementMetric(directory, "memory_duplicates", 1, null, sessionId);
        return {
          status: "merged_with_existing",
          existing_id: duplicate.id,
          message: "Similar fact already exists in memory"
        };
      }

      const contradiction = detectContradiction(directory, newFact);
      if (contradiction) {
        incrementMetric(directory, "memory_contradictions", 1, null, sessionId);
        return {
          status: "conflict_detected",
          conflicting_id: contradiction.id,
          message: "New fact contradicts existing knowledge"
        };
      }

      const sourceTask = args.task_id || readState(directory).task_id || "current";

      const factsPath = join(directory, OPENC_DIR, "memory/facts.jsonl");
      const factId = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      const factEntry = {
        id: factId,
        date: new Date().toISOString().split('T')[0],
        domain,
        fact,
        implication,
        evidence,
        confidence,
        status: "active",
        source_task: sourceTask,
        created_at: new Date().toISOString()
      };

      appendFileSync(factsPath, JSON.stringify(factEntry) + "\n");
      regenerateMemoryMd(directory);

      logAudit(directory, { event: "memory_added", fact_id: factId, domain, source_task: sourceTask });
      incrementMetric(directory, "memory_adds", 1, null, sessionId);

      return { status: "created", fact_id: factId, source_task: sourceTask };
    }
  };
}

export function memoryNoOpTool(context) {
  return {
    description: "Record that no new knowledge was found. Always pass task_id when closing a task.",
    args: {
      reason: { type: "string" },
      task_id: { type: "string", optional: true },
    },
    async execute(args) {
      const { reason } = args;
      const { directory, sessionId } = context;

      if (!reason || reason.trim().length === 0) {
        return { status: "error", reason: "Reason cannot be empty" };
      }

      const tid = args.task_id || readState(directory).task_id;
      const suffix = tid || String(Date.now());
      const noOpPath = join(directory, OPENC_DIR, `memory/no_op_${suffix}.json`);
      writeFileSync(noOpPath, JSON.stringify({
        reason,
        task_id: tid || null,
        created_at: new Date().toISOString()
      }, null, 2));

      logAudit(directory, { event: "memory_no_op", reason, task_id: tid || null });
      incrementMetric(directory, "memory_no_ops", 1, null, sessionId);

      return { status: "no_op", task_id: tid || null };
    }
  };
}
