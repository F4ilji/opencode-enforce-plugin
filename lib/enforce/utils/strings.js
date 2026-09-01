import { getConfig } from "../config.js";

export function trimOutput(output, maxLines = 30) {
  if (!output) return "";
  const lines = output.split("\n");
  if (lines.length <= maxLines) return output;
  return "... (trimmed) ...\n" + lines.slice(-maxLines).join("\n");
}

export function shQuote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

export function toContainerPath(rel, directory) {
  if (!directory) {
    if (rel.startsWith("crawler/")) return rel.slice("crawler/".length);
    return rel;
  }
  const cfg = getConfig(directory);
  const prefix = cfg.container_path_prefix || "";
  if (prefix && rel.startsWith(prefix)) return rel.slice(prefix.length);
  return rel;
}

export function diceCoefficient(a, b) {
  const s1 = a.toLowerCase();
  const s2 = b.toLowerCase();
  if (s1.length < 2 || s2.length < 2) return 0;
  const bigrams1 = new Map();
  for (let i = 0; i < s1.length - 1; i++) {
    const b = s1.substring(i, i + 2);
    bigrams1.set(b, (bigrams1.get(b) || 0) + 1);
  }
  let intersection = 0;
  for (let i = 0; i < s2.length - 1; i++) {
    const b = s2.substring(i, i + 2);
    const count = bigrams1.get(b) || 0;
    if (count > 0) {
      bigrams1.set(b, count - 1);
      intersection++;
    }
  }
  return (2.0 * intersection) / (s1.length - 1 + s2.length - 1);
}
