import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const OPENC_DIR = ".opencode";

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
};

class CompiledConfig {
  constructor(config) {
    this._config = config;
    this._controlPlaneFiles = config.control_plane_files.map((p) => new RegExp(p));
  }

  get preflight() { return this._config.preflight; }
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
