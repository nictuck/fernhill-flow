# One command per check. CI runs `make check`. The first plan replaces the
# TODO bodies with the real stack commands and removes the notice.
.PHONY: check build test lint dev

check: build test lint
	@echo "check: ok"

build:
	@echo "TODO: configure 'make build' for this stack (plan step 1)"

test:
	@echo "TODO: configure 'make test' for this stack (plan step 1)"

lint:
	@echo "TODO: configure 'make lint' for this stack (plan step 1)"

dev:
	@echo "TODO: configure 'make dev' for this stack (plan step 1)"
