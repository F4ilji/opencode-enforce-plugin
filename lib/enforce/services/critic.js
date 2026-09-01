import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { OPENC_DIR, ROUTERAI_CHAT_ENDPOINT } from "../config.js";

function parseDotEnv(content) {
  const out = {};
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

export function loadRouterConfig(directory) {
  let apiKey = process.env.ROUTERAI_API_KEY || null;
  let model = process.env.ROUTERAI_MODEL || null;
  let apiKeySource = apiKey ? "process.env" : null;
  let modelSource = model ? "process.env" : null;

  const candidates = [
    join(directory, ".env"),
    join(directory, OPENC_DIR, "routerai.env"),
  ];

  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const vars = parseDotEnv(readFileSync(p, "utf8"));
        if (!apiKey && vars.ROUTERAI_API_KEY) { apiKey = vars.ROUTERAI_API_KEY; apiKeySource = p; }
        if (!model && vars.ROUTERAI_MODEL) { model = vars.ROUTERAI_MODEL; modelSource = p; }
      } catch (e) { /* ignore */ }
    }
  }

  return {
    apiKey,
    model: model || "gpt-4",
    apiKeySource,
    modelSource: modelSource || apiKeySource || null
  };
}

function extractCriticContent(data) {
  const msg = data && data.choices && data.choices[0] && data.choices[0].message;
  if (!msg) return null;
  if (typeof msg.content === "string" && msg.content.trim()) return msg.content;
  if (Array.isArray(msg.content)) {
    const joined = msg.content.map(p => (p && (p.text || p.content)) || "").join("");
    if (joined.trim()) return joined;
  }
  if (typeof msg.reasoning_content === "string" && msg.reasoning_content.trim()) return msg.reasoning_content;
  return null;
}

export async function callCritic(systemPrompt, userPrompt, cfg) {
  if (!cfg.apiKey) {
    return { error: "ROUTERAI_API_KEY not found (checked: process.env, .env, .opencode/routerai.env)" };
  }

  try {
    const response = await fetch(ROUTERAI_CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { error: `RouterAI API error: ${response.status} ${errorText}` };
    }

    const data = await response.json();
    const content = extractCriticContent(data);

    if (!content) {
      return { error: `Empty response from critic (content and reasoning_content are null). Model: ${cfg.model}. Check model availability in routerai catalog.` };
    }

    try {
      const parsed = JSON.parse(content);
      return {
        verdict: parsed.verdict || "unknown",
        feedback: parsed.feedback || [],
        raw_response: content
      };
    } catch (e) {
      const verdictMatch = content.match(/verdict:\s*(approved|changes_requested)/i);
      return {
        verdict: verdictMatch ? verdictMatch[1].toLowerCase() : "unknown",
        feedback: [content],
        raw_response: content
      };
    }
  } catch (e) {
    return { error: `Network error: ${e.message}` };
  }
}
