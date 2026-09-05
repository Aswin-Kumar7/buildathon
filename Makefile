.PHONY: help up down dev check test clean

help:
	@echo "up      - start local dependencies (postgres)"
	@echo "down    - stop local dependencies"
	@echo "dev     - run api and web in watch mode"
	@echo "check   - the fast gate: lint, typecheck, unit tests, format, data guard"
	@echo "test    - unit tests"
	@echo "clean   - remove build output and caches"

up:
	docker compose up -d

down:
	docker compose down

dev:
	pnpm dev

check:
	pnpm check

test:
	pnpm test:unit

clean:
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
	rm -rf apps/*/dist packages/*/dist .turbo
