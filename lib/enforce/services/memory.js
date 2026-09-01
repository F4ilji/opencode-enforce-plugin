import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { OPENC_DIR, getConfig } from "../config.js";
import { logAudit } from "../utils/audit.js";
import { diceCoefficient } from "../utils/strings.js";

function readFactsJsonl(directory) {
  const p = join(directory, OPENC_DIR, "memory/facts.jsonl");
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").split("\n").filter(l => l.trim());
  const facts = [];
  for (const line of lines) {
    try {
      facts.push(JSON.parse(line));
    } catch (e) {
      logAudit(directory, { event: "fact_parse_failed", error: String(e.message ?? e) });
    }
  }
  return facts;
}

export function findDuplicateFact(directory, newFact) {
  const facts = readFactsJsonl(directory);
  const activeFacts = facts.filter(f => f.status === "active");

  for (const existing of activeFacts) {
    if (existing.domain !== newFact.domain) continue;

    const similarity = diceCoefficient(existing.fact, newFact.fact);
    if (similarity > 0.85) {
      return existing;
    }
  }
  return null;
}

export function detectContradiction(directory, newFact) {
  const facts = readFactsJsonl(directory);
  const activeFacts = facts.filter(f => f.status === "active" && f.domain === newFact.domain);

  const contradictions = [
    { pattern: /\b(?:should|must)\b(?!\s+not)/i, opposite: /\b(?:should\s+not|must\s+not|never)\b/i },
    { pattern: /\balways\b/i, opposite: /\b(?:never|sometimes)\b/i },
    { pattern: /\bnever\b/i, opposite: /\b(?:always|sometimes)\b/i },
    { pattern: /\b(?:increase|expand|enable)\b/i, opposite: /\b(?:decrease|reduce|disable)\b/i },
    { pattern: /\b(?:decrease|reduce|disable)\b/i, opposite: /\b(?:increase|expand|enable)\b/i },
  ];

  for (const existing of activeFacts) {
    for (const { pattern, opposite } of contradictions) {
      if (pattern.test(newFact.fact) && opposite.test(existing.fact)) {
        return existing;
      }
      if (opposite.test(newFact.fact) && pattern.test(existing.fact)) {
        return existing;
      }
    }
  }
  return null;
}

export function getMemoryDomains(directory) {
  const cfg = getConfig(directory);
  return cfg.memory_domains;
}

export { readFactsJsonl };
