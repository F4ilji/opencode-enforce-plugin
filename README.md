# Enforce Plugin for OpenCode

Плагин для opencode, который реализует протокол разработки с задачами, планами, ревью и памятью.

## Установка

```bash
cd /path/to/project
make -f /Users/failj/projects/enforce-plugin/Makefile install
```

Или через alias (после source ~/.zshrc):

```bash
cd /path/to/project
enforce-install
```

## Что устанавливается

- `.opencode/plugins/enforce.js` — точка входа
- `.opencode/lib/enforce/` — основная библиотека
- `.opencode/package.json` — зависимости
- `.opencode/config.json` — конфигурация (если не существует)
- `AGENTS.md` — протокол работы agent'а (если не существует)

## Конфигурация

Отредактируйте `.opencode/config.json` под свой проект:

- `service` — имя Docker-сервиса
- `container_path_prefix` — префикс пути в контейнере
- `service_rules` — правила определения сервисов по путям файлов
- `memory_domains` — домены памяти
- `impact_map` — карта рисков файлов
- `preflight` — команды preflight (compile, lint, test)
- `budget_limits` — лимиты бюджета
- `critic_system_prompt` — промпт для Fresh Critic

## Использование

После установки плагин автоматически загружается при старте opencode. Доступные инструменты:

- `create_task()` — создание задач
- `create_plan()` — создание плана
- `approve_plan()` — одобрение плана
- `request_review()` — запрос ревью
- `complete_task()` — завершение задачи
- `memory_add()` — добавление в память
- `get_dashboard()` — дашборд

## Удаление

```bash
make -f /Users/failj/projects/enforce-plugin/Makefile uninstall
```
