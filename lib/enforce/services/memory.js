import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { OPENC_DIR, getConfig } from "../config.js";
import { diceCoefficient } from "../utils/strings.js";

function readFactsJsonl(directory) {
  const p = join(directory, OPENC_DIR, "memory/facts.jsonl");
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").split("\n").filter(l => l.trim());
  const facts = [];
  for (const line of lines) {
    try {
      facts.push(JSON.parse(line));
    } catch (e) { /* ignore malformed */ }
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
    { pattern: /should/i, opposite: /should not|must not|never/i },
    { pattern: /always/i, opposite: /never|sometimes/i },
    { pattern: /never/i, opposite: /always|sometimes/i },
    { pattern: /increase/i, opposite: /decrease|reduce/i },
    { pattern: /decrease|reduce/i, opposite: /increase/i },
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
