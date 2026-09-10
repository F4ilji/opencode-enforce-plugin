export function trimOutput(output, maxLines = 30) {
  if (!output) return "";
  const lines = output.split("\n");
  if (lines.length <= maxLines) return output;
  return "... (trimmed) ...\n" + lines.slice(-maxLines).join("\n");
}

export function shQuote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}


