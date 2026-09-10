import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const OPENC_DIR = ".opencode";
export const ROUTERAI_CHAT_ENDPOINT = "https://routerai.ru/api/v1/chat/completions";

export const RISK_ORDER = { low: 0, medium: 1, high: 2 };

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

const DEFAULT_CONFIG = {
  control_plane_files: [
    "\\.opencode/plugins/",
    "(^|/)AGENTS\\.md$",
    "(^|/)docker-compose(\\.[\\w-]+)?\\.ya?ml$",
    "(^|/)Dockerfile$",
    "(^|/)\\.env",
  ],
  preflight: {
    compileall_cmd: "",
    linter_cmd: "",
    test_cmd: "",
    timeouts: {
      compileall: 60000,
      linter: 60000,
      test: 300000,
    },
  },
  budget_limits: {
    max_attempts: 4,
    max_minutes: 60,
    max_files: 50,
  },
  critic_system_prompt: `You are a Fresh Critic — an independent code reviewer.
Your role:
- Verify surgical edits (no implicit refactoring)
- Check consistency with existing patterns
- Validate acceptance criteria
- Flag security issues clearly
- Focus on CHANGES shown in the diff, not pre-existing code, unless it violates a critical rule
- Be terse and direct

Apply rules proportionally to task scope:
- Trivial tasks (single file, <50 lines): only flag security issues and syntax errors
- Medium tasks: apply all architecture rules
- High-risk tasks: full strict review including tests, error handling

Respond in JSON format:
{
"verdict": "approved" | "changes_requested",
"feedback": ["specific issue 1", "specific issue 2"]
}`,
};

class CompiledConfig {
  constructor(config) {
    this._config = config;
    this._controlPlaneFiles = config.control_plane_files.map((p) => new RegExp(p));
  }

  get preflight() { return this._config.preflight; }
  get budget_limits() { return this._config.budget_limits; }
  get critic_system_prompt() { return this._config.critic_system_prompt; }
  get control_plane_files() { return this._config.control_plane_files; }
  get controlPlaneFilesCompiled() { return this._controlPlaneFiles; }
}

let _compiledConfig = null;
let _configDir = null;

function loadProjectConfig(directory) {
  const configPath = join(directory, OPENC_DIR, "config.json");
  if (!existsSync(configPath)) {
    return new CompiledConfig(DEFAULT_CONFIG);
  }
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8"));
    return new CompiledConfig(deepMerge(DEFAULT_CONFIG, raw));
  } catch (e) {
    console.error(`[enforce] Failed to load config from ${configPath}:`, e.message);
    return new CompiledConfig(DEFAULT_CONFIG);
  }
}

export function getConfig(directory) {
  if (_compiledConfig && _configDir === directory) return _compiledConfig;
  _compiledConfig = loadProjectConfig(directory);
  _configDir = directory;
  return _compiledConfig;
}

