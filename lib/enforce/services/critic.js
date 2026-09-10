import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROUTERAI_CHAT_ENDPOINT } from "../config.js";

export function loadRouterConfig(directory) {
  const result = { apiKey: null, model: null, apiKeySource: null, modelSource: null };

  const envFile = join(directory, ".opencode", "routerai.env");
  const files = [join(directory, ".env"), envFile];

  const envKeys = { apiKey: "ROUTERAI_API_KEY", model: "ROUTERAI_MODEL" };

  for (const key of Object.keys(envKeys)) {
    const envVar = envKeys[key];
    if (process.env[envVar]) {
      result[key] = process.env[envVar];
      result[key + "Source"] = "process.env";
      continue;
    }
    for (const f of files) {
      try {
        if (!existsSync(f)) continue;
        const content = readFileSync(f, "utf8");
        const match = content.match(new RegExp(`^${envVar}\\s*=\\s*(.+)$`, "m"));
        if (match) {
          result[key] = match[1].trim().replace(/^["']|["']$/g, "");
          result[key + "Source"] = f;
          break;
        }
      } catch (e) {
        /* ignore */
      }
    }
  }

  return result;
}

export async function callCritic(systemPrompt, userPrompt, cfg) {
  if (!cfg.apiKey) {
    return { error: "ROUTERAI_API_KEY not configured" };
  }

  try {
    const response = await fetch(ROUTERAI_CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { error: `RouterAI HTTP ${response.status}: ${text.slice(0, 200)}` };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          verdict: parsed.verdict || "approved",
          feedback: parsed.feedback || [],
        };
      } catch (e) {
        return { verdict: "approved", feedback: ["Critic returned non-JSON response"] };
      }
    }

    return { verdict: "approved", feedback: [] };
  } catch (e) {
    return { error: `RouterAI request failed: ${e.message}` };
  }
}
