export class PluginContext {
  constructor(directory) {
    this.directory = directory;
    this.winEdited = new Set();
    this.winRestarted = new Set();
    this.sessionId = null;
    this.consecutiveFailures = 0;
    this.breakerNotified = false;
    this.lastPreflightResult = null;
  }

  resetWindow() {
    this.winEdited.clear();
    this.winRestarted.clear();
  }
}
