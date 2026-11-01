# One command per check. CI runs `make check`; Netlify runs `make build`.
# Dependencies: `npm ci` (CI and Netlify do it before these targets).
.PHONY: check build test lint dev spike

check: build test lint
	@echo "check: ok"

build:
	npm run build

test:
	npm test

lint:
	npm run lint

# Local, no token: fixture data. http://localhost:8888
dev:
	npm run dev

# Plan step 1: measure the live collector against the real repos (R15).
# Uses the local `gh` login; the token stays in the process env.
spike:
	GITHUB_TOKEN="$$(gh auth token)" npm run spike
