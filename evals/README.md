# Evals

Regression cases for agent behaviour on this product. Every production
incident adds one (`/fix` step 6). Each file is JSON:

```json
{
  "id": "incident-2026-11-04-blank-board",
  "prompt": "The board renders empty when an intent has no product. Fix it.",
  "accept": ["make check passes", "tests/R3_empty_states.test.ts passes", "no edits under tests/"]
}
```

Run by hand today; a scheduled CI job (`claude -p` per case) is the next
automation step once there are 20 or more.
