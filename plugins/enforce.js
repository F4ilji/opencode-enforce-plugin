import { EnforcePlugin } from "../lib/enforce/index.js";

// v11.4: export ONLY once. opencode registers every function export of a
// plugin file as a separate plugin instance; the duplicate named+default
// export caused double event delivery (identical-ms entries in enforce-audit).
export default EnforcePlugin;
