# First Run Setup

This plugin needs configuration for your project. Answer these questions:

## 1. Tech Stack
- Language(s): (e.g., Python, TypeScript, Go, Rust)
- Framework(s): (e.g., FastAPI, Django, Express, Gin)
- Database(s): (e.g., PostgreSQL, MySQL, MongoDB, Redis)
- Other tools: (e.g., Celery, RabbitMQ, Kafka)

## 2. Infrastructure
- Do you use Docker? (yes/no)
- If yes, what's the main service name in docker-compose? (e.g., app, web, api)
- What's the command to run tests? (e.g., pytest, npm test, go test)
- What's the linter? (e.g., ruff, eslint, golangci-lint)
- What's the compile/syntax check command? (e.g., python -m compileall, tsc --noEmit)

## 3. Project Structure
- What are the main directories/modules? (e.g., src/, api/, services/, models/)
- What file patterns indicate different services? (e.g., api/ → API, services/ → business logic)

## 4. Architecture Rules
- Any specific architecture pattern? (e.g., Clean Architecture, MVC, hexagonal)
- Any specific coding conventions? (e.g., all functions must have docstrings, error handling patterns)

## 5. Memory Domains
- What domains should memory track? (e.g., api, database, auth, payments, infra)

## 6. Risk Patterns
- What files are high-risk? (e.g., docker-compose.yml, Dockerfile, .env, migrations/)
- What files are medium-risk? (e.g., models.py, schema files)
- What files are low-risk? (e.g., README.md, comments)

## 7. Review Prompt
- Any specific review rules for your project? (e.g., "Always check for SQL injection", "Verify API response formats")

After answering, I will:
1. Fill in `<tech_stack>`, `<architecture_rules>`, `<infrastructure_commands>` sections in AGENTS.md
2. Update `.opencode/config.json` with your settings
