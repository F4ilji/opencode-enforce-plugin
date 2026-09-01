import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { OPENC_DIR } from "../config.js";
import { ensureDir, readState, writeState } from "../utils/fs.js";

function regenerateMemoryMd(directory) {
  const factsPath = join(directory, OPENC_DIR, "memory/facts.jsonl");
  const memoryMdPath = join(directory, "MEMORY.md");

  let facts = [];
  if (existsSync(factsPath)) {
    const lines = readFileSync(factsPath, "utf8")
      .split("\n")
      .filter((l) => l.trim());
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.status === "active") facts.push(obj);
      } catch (e) {
        /* ignore malformed */
      }
    }
  }

  facts.sort(
    (a, b) =>
      new Date(b.date || b.created_at) - new Date(a.date || a.created_at),
  );

  const grouped = {};
  for (const f of facts) {
    if (!grouped[f.domain]) grouped[f.domain] = [];
    if (grouped[f.domain].length < 20) grouped[f.domain].push(f);
  }

  let md = `# Memory\n*Generated from facts.jsonl at ${new Date().toISOString()}*\n\n`;
  for (const [domain, domainFacts] of Object.entries(grouped)) {
    md += `## ${domain}\n`;
    for (const f of domainFacts) {
      md += `- [${f.date}] ${f.fact} → ${f.implication} (confidence: ${f.confidence})\n`;
    }
    md += "\n";
  }

  writeFileSync(memoryMdPath, md);
}

export function migratePhase0(directory) {
  const opencodeDir = join(directory, OPENC_DIR);
  ensureDir(opencodeDir);

  const dirs = [
    "pending/open",
    "pending/resolved",
    "plans",
    "receipts",
    "approvals",
    "memory",
    "artifacts",
    "reviews",
  ];
  dirs.forEach((d) => ensureDir(join(opencodeDir, d)));

  const legacyPendingPath = join(opencodeDir, "enforce-pending.md");
  const pendingOpenDir = join(opencodeDir, "pending/open");

  if (existsSync(legacyPendingPath)) {
    const content = readFileSync(legacyPendingPath, "utf8").trim();
    if (content) {
      const taskId = `TASK-LEGACY-${Date.now()}`;
      const taskCard = {
        task_id: taskId,
        description: content,
        created_at: new Date().toISOString(),
        priority: "high",
        acceptance_criteria: ["Resolve legacy pending item"],
      };
      writeFileSync(
        join(pendingOpenDir, `${taskId}.json`),
        JSON.stringify(taskCard, null, 2),
      );
    }
    unlinkSync(legacyPendingPath);
  }

  const legacyMemoryPath = join(directory, "MEMORY.md");
  const factsPath = join(opencodeDir, "memory/facts.jsonl");

  if (existsSync(legacyMemoryPath) && !existsSync(factsPath)) {
    const memContent = readFileSync(legacyMemoryPath, "utf8");
    const lines = memContent.split("\n").filter((l) => l.trim());
    const facts = [];
    const regex = /^\[([^\]]+)\]\[([^\]]+)\]\s*(.+?)(?:->\s*(.+))?$/;

    for (const line of lines) {
      const match = line.match(regex);
      if (match) {
        facts.push({
          id: `mem_legacy_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          date: match[1],
          domain: match[2],
          fact: match[3].trim(),
          implication: match[4] ? match[4].trim() : "N/A",
          evidence: "legacy_migration",
          confidence: 1.0,
          status: "active",
          source_task: "legacy",
          created_at: new Date().toISOString(),
        });
      } else if (line.trim() && !line.startsWith("#")) {
        facts.push({
          id: `mem_legacy_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          date: new Date().toISOString().split("T")[0],
          domain: "general",
          fact: line.trim(),
          implication: "N/A",
          evidence: "legacy_migration",
          confidence: 0.8,
          status: "active",
          source_task: "legacy",
          created_at: new Date().toISOString(),
        });
      }
    }

    if (facts.length > 0) {
      writeFileSync(
        factsPath,
        facts.map((f) => JSON.stringify(f)).join("\n") + "\n",
      );
    }
  }

  regenerateMemoryMd(directory);

  const stateFile = join(opencodeDir, "state.json");
  if (!existsSync(stateFile)) {
    writeFileSync(
      stateFile,
      JSON.stringify(
        {
          task_id: null,
          phase: "pending",
          attempts: 0,
          restarts: 0,
          task_files: [],
          started_at: new Date().toISOString(),
          session_started_at: new Date().toISOString(),
          task_started_at: null,
          first_edit_at: null,
          plan_created_at: null,
          plan_approved_at: null,
          plan_warning_sent: false,
          session_id: null,
          auto_commit: false,
          last_activity: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } else {
    const state = readState(directory);
    let dirty = false;
    if (!state.session_started_at) {
      state.session_started_at = state.started_at || new Date().toISOString();
      dirty = true;
    }
    if (!("task_started_at" in state)) {
      state.task_started_at = null;
      dirty = true;
    }
    if (!("task_id" in state)) {
      state.task_id = null;
      dirty = true;
    }
    if (!("task_files" in state)) {
      state.task_files = [];
      dirty = true;
    }
    if (!("first_edit_at" in state)) {
      state.first_edit_at = null;
      dirty = true;
    }
    if (!("plan_created_at" in state)) {
      state.plan_created_at = null;
      dirty = true;
    }
    if (!("plan_approved_at" in state)) {
      state.plan_approved_at = null;
      dirty = true;
    }
    if (!("plan_warning_sent" in state)) {
      state.plan_warning_sent = false;
      dirty = true;
    }
    if (!("session_id" in state)) {
      state.session_id = null;
      dirty = true;
    }
    if (!("auto_commit" in state)) {
      state.auto_commit = false;
      dirty = true;
    }
    if (dirty) writeState(directory, state);
  }
}

export { regenerateMemoryMd };
