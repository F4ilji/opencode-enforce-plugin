PLUGIN_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
TARGET_DIR ?= .

.PHONY: install uninstall clean help

help:
	@echo "Установка enforce плагина opencode"
	@echo ""
	@echo "Использование:"
	@echo "  make install                  - Установить в текущую директорию"
	@echo "  make install TARGET_DIR=/path - Установить в указанную директорию"
	@echo "  make uninstall                - Удалить плагин"
	@echo "  make clean                    - Удалить плагин и данные сессий"

install:
	@mkdir -p $(TARGET_DIR)/.opencode/plugins
	@mkdir -p $(TARGET_DIR)/.opencode/lib
	@cp $(PLUGIN_DIR)plugins/enforce.js $(TARGET_DIR)/.opencode/plugins/
	@cp -r $(PLUGIN_DIR)lib/enforce $(TARGET_DIR)/.opencode/lib/
	@cp $(PLUGIN_DIR)package.json $(TARGET_DIR)/.opencode/
	@test -f $(TARGET_DIR)/.opencode/config.json || cp $(PLUGIN_DIR)config.default.json $(TARGET_DIR)/.opencode/config.json
	@test -f $(TARGET_DIR)/AGENTS.md || cp $(PLUGIN_DIR)AGENTS.md.example $(TARGET_DIR)/AGENTS.md
	@test -f $(TARGET_DIR)/SETUP_QUESTIONNAIRE.md || cp $(PLUGIN_DIR)SETUP_QUESTIONNAIRE.md $(TARGET_DIR)/
	@cd $(TARGET_DIR)/.opencode && npm install --silent
	@echo "✅ Enforce plugin установлен"

uninstall:
	@rm -f $(TARGET_DIR)/.opencode/plugins/enforce.js
	@rm -rf $(TARGET_DIR)/.opencode/lib/enforce
	@echo "✅ Enforce plugin удален"

clean: uninstall
	@rm -rf $(TARGET_DIR)/.opencode/approvals
	@rm -rf $(TARGET_DIR)/.opencode/artifacts
	@rm -rf $(TARGET_DIR)/.opencode/memory
	@rm -rf $(TARGET_DIR)/.opencode/pending
	@rm -rf $(TARGET_DIR)/.opencode/plans
	@rm -rf $(TARGET_DIR)/.opencode/receipts
	@rm -rf $(TARGET_DIR)/.opencode/reviews
	@rm -f $(TARGET_DIR)/.opencode/state.json
	@rm -f $(TARGET_DIR)/.opencode/tech_debt.json
	@rm -f $(TARGET_DIR)/.opencode/metrics.jsonl
	@rm -f $(TARGET_DIR)/.opencode/enforce-audit.jsonl
	@rm -f $(TARGET_DIR)/.opencode/MEMORY.md
	@echo "✅ Данные сессий очищены"
