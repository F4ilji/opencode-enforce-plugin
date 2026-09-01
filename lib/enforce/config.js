import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const OPENC_DIR = ".opencode";
export const ROUTERAI_BASE_URL = "https://routerai.ru/api/v1";
export const ROUTERAI_CHAT_ENDPOINT = `${ROUTERAI_BASE_URL}/chat/completions`;

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

function validateConfig(config) {
  const errors = [];
  if (!config.service || typeof config.service !== "string") {
    errors.push("service: must be a non-empty string");
  }
  if (!Array.isArray(config.service_rules)) {
    errors.push("service_rules: must be an array");
  } else {
    for (const rule of config.service_rules) {
      if (!Array.isArray(rule) || rule.length !== 2) {
        errors.push("service_rules: each rule must be [pattern, service_name]");
      }
    }
  }
  if (!Array.isArray(config.memory_domains)) {
    errors.push("memory_domains: must be an array");
  }
  if (!Array.isArray(config.impact_map)) {
    errors.push("impact_map: must be an array");
  } else {
    for (const item of config.impact_map) {
      if (!item.pattern || !item.risk) {
        errors.push("impact_map: each item must have pattern and risk");
      }
      try {
        new RegExp(item.pattern);
      } catch (e) {
        errors.push(`impact_map: invalid regex pattern "${item.pattern}"`);
      }
    }
  }
  if (!Array.isArray(config.control_plane_files)) {
    errors.push("control_plane_files: must be an array");
  } else {
    for (const pattern of config.control_plane_files) {
      try {
        new RegExp(pattern);
      } catch (e) {
        errors.push(`control_plane_files: invalid regex pattern "${pattern}"`);
      }
    }
  }
  if (!Array.isArray(config.service_file)) {
    errors.push("service_file: must be an array");
  } else {
    for (const pattern of config.service_file) {
      try {
        new RegExp(pattern);
      } catch (e) {
        errors.push(`service_file: invalid regex pattern "${pattern}"`);
      }
    }
  }
  if (!config.preflight || typeof config.preflight !== "object") {
    errors.push("preflight: must be an object");
  }
  if (!config.budget_limits || typeof config.budget_limits !== "object") {
    errors.push("budget_limits: must be an object");
  }
  return errors;
}

const DEFAULT_CONFIG = {
  service: "crawler",
  container_path_prefix: "crawler/",
  service_rules: [
    ["crawler/web|templates|views|app.py|static", "web"],
    ["spiders|middlewares|pipelines", "crawler"],
    ["api/", "api"]
  ],
  memory_domains: [
    "spiders", "pipelines", "middlewares", "storage", "db",
    "playwright", "infra", "web", "anti-bot", "docs", "procedural", "general"
  ],
  impact_map: [
    { pattern: "^docker-compose(\\.[\\w-]+)?\\.ya?ml$", risk: "high", approval: true },
    { pattern: "^Dockerfile$", risk: "high", approval: true },
    { pattern: "^\\.env", risk: "high", approval: true },
    { pattern: "^AGENTS\\.md$", risk: "high", approval: true },
    { pattern: "^\\.opencode/plugins/", risk: "high", approval: true },
    { pattern: "^db/migrations/", risk: "high", approval: true },
    { pattern: "models\\.py$", risk: "medium", approval: false },
    { pattern: "pydantic_schemas/", risk: "medium", approval: false },
    { pattern: "\\.ya?ml$", risk: "low", approval: false },
    { pattern: "\\.md$", risk: "low", approval: false }
  ],
  control_plane_files: [
    "\\.opencode/plugins/",
    "(^|/)AGENTS\\.md$",
    "(^|/)docker-compose(\\.[\\w-]+)?\\.ya?ml$",
    "(^|/)Dockerfile$",
    "(^|/)\\.env",
    "^db/migrations/"
  ],
  service_file: [
    "\\.opencode/",
    "(^|/)(MEMORY\\.md|notes\\.md|AGENTS\\.md|facts\\.jsonl|state\\.json|metrics\\.jsonl|enforce-audit\\.jsonl|tech_debt\\.json)$"
  ],
  preflight: {
    compileall_cmd: "python3 -m compileall -q .",
    linter_cmd: "ruff check --output-format json {file}",
    test_cmd: "python3 -m pytest tests/unit -q --tb=short -x --maxfail=1",
    timeouts: {
      compileall: 60000,
      ruff: 60000,
      pytest: 300000
    }
  },
  budget_limits: {
    max_attempts: 4,
    max_restarts: 3,
    max_minutes: 60,
    max_files: 50
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
}`
};

class CompiledConfig {
  constructor(config) {
    this._config = config;
    this._impactMap = config.impact_map.map(item => ({
      ...item,
      pattern: new RegExp(item.pattern)
    }));
    this._controlPlaneFiles = config.control_plane_files.map(p => new RegExp(p));
    this._serviceFile = config.service_file.map(p => new RegExp(p));
    this._serviceRules = config.service_rules.map(([pattern, svc]) => ({
      pattern: new RegExp(pattern),
      service: svc
    }));
  }

  get service() { return this._config.service; }
  get container_path_prefix() { return this._config.container_path_prefix; }
  get memory_domains() { return this._config.memory_domains; }
  get preflight() { return this._config.preflight; }
  get budget_limits() { return this._config.budget_limits; }
  get critic_system_prompt() { return this._config.critic_system_prompt; }
  get impact_map() { return this._config.impact_map; }
  get control_plane_files() { return this._config.control_plane_files; }
  get service_file() { return this._config.service_file; }
  get service_rules() { return this._config.service_rules; }

  get impactMapCompiled() { return this._impactMap; }
  get controlPlaneFilesCompiled() { return this._controlPlaneFiles; }
  get serviceFileCompiled() { return this._serviceFile; }
  get serviceRulesCompiled() { return this._serviceRules; }
}

let _compiledConfig = null;
let _configDir = null;

export function loadProjectConfig(directory) {
  const configPath = join(directory, OPENC_DIR, "config.json");
  if (!existsSync(configPath)) {
    return new CompiledConfig(DEFAULT_CONFIG);
  }
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8"));
    const merged = deepMerge(DEFAULT_CONFIG, raw);
    const errors = validateConfig(merged);
    if (errors.length > 0) {
      console.error(`[enforce] Config validation errors in ${configPath}:`, errors);
      return new CompiledConfig(DEFAULT_CONFIG);
    }
    return new CompiledConfig(merged);
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

export function resetConfigCache() {
  _compiledConfig = null;
  _configDir = null;
}

export function compileImpactMap(impactMap) {
  return impactMap.map(item => ({
    ...item,
    pattern: new RegExp(item.pattern)
  }));
}

export function compileRegexArray(arr) {
  return arr.map(pattern => new RegExp(pattern));
}
