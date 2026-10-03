PLUGIN_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
TARGET_DIR ?= .

.PHONY: install update uninstall clean help

help:
	@echo "Enforce-TDD V2 plugin for opencode"
	@echo ""
	@echo "Usage:"
	@echo "  make install                  - Install to current directory"
	@echo "  make install TARGET_DIR=/path - Install to specified directory"
	@echo "  make update                   - Update plugin (preserves config.json and AGENTS.md)"
	@echo "  make uninstall                - Remove plugin files"
	@echo "  make clean                    - Remove plugin and session data"

install:
	@command -v npm >/dev/null 2>&1 || { echo "Error: npm not found"; exit 1; }
	@mkdir -p $(TARGET_DIR)/.opencode/plugins
	@mkdir -p $(TARGET_DIR)/.opencode/lib
	@cp $(PLUGIN_DIR)plugins/enforce.js $(TARGET_DIR)/.opencode/plugins/
	@rm -rf $(TARGET_DIR)/.opencode/lib/enforce
	@cp -r $(PLUGIN_DIR)lib/enforce $(TARGET_DIR)/.opencode/lib/
	@cp $(PLUGIN_DIR)package.json $(TARGET_DIR)/.opencode/
	@test -f $(TARGET_DIR)/.opencode/config.json || cp $(PLUGIN_DIR)config.default.json $(TARGET_DIR)/.opencode/config.json
	@test -f $(TARGET_DIR)/AGENTS.md.example || cp $(PLUGIN_DIR)AGENTS.md.example $(TARGET_DIR)/AGENTS.md.example
	@test -f $(TARGET_DIR)/AGENTS.md || mv $(TARGET_DIR)/AGENTS.md.example $(TARGET_DIR)/AGENTS.md
	@test -f $(TARGET_DIR)/SETUP_QUESTIONNAIRE.md || cp $(PLUGIN_DIR)SETUP_QUESTIONNAIRE.md $(TARGET_DIR)/SETUP_QUESTIONNAIRE.md
	@touch $(TARGET_DIR)/.gitignore
	@grep -qxF '.opencode/' $(TARGET_DIR)/.gitignore 2>/dev/null || echo '.opencode/' >> $(TARGET_DIR)/.gitignore
	@grep -qxF '.log/' $(TARGET_DIR)/.gitignore 2>/dev/null || echo '.log/' >> $(TARGET_DIR)/.gitignore
	@cd $(TARGET_DIR)/.opencode && npm install --silent
	@echo "Enforce-TDD V2 installed"

update:
	@command -v npm >/dev/null 2>&1 || { echo "Error: npm not found"; exit 1; }
	@mkdir -p $(TARGET_DIR)/.opencode/plugins
	@mkdir -p $(TARGET_DIR)/.opencode/lib
	@cp $(PLUGIN_DIR)plugins/enforce.js $(TARGET_DIR)/.opencode/plugins/
	@rm -rf $(TARGET_DIR)/.opencode/lib/enforce
	@cp -r $(PLUGIN_DIR)lib/enforce $(TARGET_DIR)/.opencode/lib/
	@cp $(PLUGIN_DIR)package.json $(TARGET_DIR)/.opencode/
	@test -f $(TARGET_DIR)/SETUP_QUESTIONNAIRE.md || cp $(PLUGIN_DIR)SETUP_QUESTIONNAIRE.md $(TARGET_DIR)/SETUP_QUESTIONNAIRE.md
	@touch $(TARGET_DIR)/.gitignore
	@grep -qxF '.opencode/' $(TARGET_DIR)/.gitignore 2>/dev/null || echo '.opencode/' >> $(TARGET_DIR)/.gitignore
	@grep -qxF '.log/' $(TARGET_DIR)/.gitignore 2>/dev/null || echo '.log/' >> $(TARGET_DIR)/.gitignore
	@cd $(TARGET_DIR)/.opencode && npm install --silent
	@echo "Enforce-TDD V2 updated (config.json and AGENTS.md preserved)"

uninstall:
	@rm -f $(TARGET_DIR)/.opencode/plugins/enforce.js
	@rm -rf $(TARGET_DIR)/.opencode/lib/enforce
	@echo "Enforce-TDD V2 removed"

clean: uninstall
	@rm -f $(TARGET_DIR)/.opencode/state.json
	@rm -f $(TARGET_DIR)/.opencode/enforce.db $(TARGET_DIR)/.opencode/enforce.db-wal $(TARGET_DIR)/.opencode/enforce.db-shm
	@rm -rf $(TARGET_DIR)/.log
	@echo "Session data cleaned"
