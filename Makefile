PLUGIN_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
TARGET_DIR ?= .

.PHONY: install update uninstall clean help

help:
	@echo "Enforce-Lite plugin for opencode"
	@echo ""
	@echo "Usage:"
	@echo "  make install                  - Install to current directory"
	@echo "  make install TARGET_DIR=/path - Install to specified directory"
	@echo "  make update                   - Update plugin (preserves config.json and AGENTS.md)"
	@echo "  make uninstall                - Remove plugin files"
	@echo "  make clean                    - Remove plugin and session data"

install:
	@mkdir -p $(TARGET_DIR)/.opencode/plugins
	@mkdir -p $(TARGET_DIR)/.opencode/lib
	@cp $(PLUGIN_DIR)plugins/enforce.js $(TARGET_DIR)/.opencode/plugins/
	@cp -r $(PLUGIN_DIR)lib/enforce $(TARGET_DIR)/.opencode/lib/
	@cp $(PLUGIN_DIR)package.json $(TARGET_DIR)/.opencode/
	@test -f $(TARGET_DIR)/.opencode/config.json || cp $(PLUGIN_DIR)config.default.json $(TARGET_DIR)/.opencode/config.json
	@test -f $(TARGET_DIR)/AGENTS.md || cp $(PLUGIN_DIR)AGENTS.md $(TARGET_DIR)/AGENTS.md
	@cd $(TARGET_DIR)/.opencode && npm install --silent
	@echo "Enforce-Lite installed"

update:
	@mkdir -p $(TARGET_DIR)/.opencode/plugins
	@mkdir -p $(TARGET_DIR)/.opencode/lib
	@cp $(PLUGIN_DIR)plugins/enforce.js $(TARGET_DIR)/.opencode/plugins/
	@cp -r $(PLUGIN_DIR)lib/enforce $(TARGET_DIR)/.opencode/lib/
	@cp $(PLUGIN_DIR)package.json $(TARGET_DIR)/.opencode/
	@cd $(TARGET_DIR)/.opencode && npm install --silent
	@echo "Enforce-Lite updated (config.json and AGENTS.md preserved)"

uninstall:
	@rm -f $(TARGET_DIR)/.opencode/plugins/enforce.js
	@rm -rf $(TARGET_DIR)/.opencode/lib/enforce
	@echo "Enforce-Lite removed"

clean: uninstall
	@rm -f $(TARGET_DIR)/.opencode/state.json
	@echo "Session data cleaned"
