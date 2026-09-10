# Memory
*Generated from facts.jsonl at 2026-09-10T17:41:22.502Z*

## general
- [2026-09-10] Makefile install/update targets now check for npm existence and use cp -n to prevent silent overwrites. install.sh removed as redundant. → Installation is safer and clearer. Users must have npm installed. (confidence: 0.95)
- [2026-09-10] On macOS cp -rn returns exit code 1 when files already exist. Added || true to suppress the error in Makefile. → make update now works correctly on macOS. (confidence: 0.95)
- [2026-09-10] Removed leftover critic.js and events.js from .opencode/lib/enforce/utils/. Now .opencode matches source exactly. → .opencode directory is now in sync with enforce-lite source. (confidence: 0.98)

