# Repository instructions

- Public repository authorized by the owner on 2026-11-10. Never commit secrets,
  credentials, private keys, .env files, node_modules, build outputs or runtime databases.
- The hosted Site remains owner-private. Do not deploy or change its audience as
  part of repository maintenance.
- Preserve primary paper session 35c81bc0-26c6-4174-8b3e-e4e416e22767 and its
  2026-11-06 through 2026-12-06 experiment. No reset, strategy/risk/model changes,
  start/resume/pause or real-money activity during evaluation.
- Read docs/DAILY_EVALUATION.md before evaluation updates.
- Archives are append-only. Preserve original snapshots; deduplicate events/trades
  by ID or timestamp and report conflicting duplicates.
- Keep candidates isolated. Never promote a candidate to the primary session automatically.
- Run npm test, npm run typecheck and node --test scalper/engine.test.mjs.
  Run the dated audit with its three reference snapshots when updating archives.
- Use normal commits. No force-push or overwriting user changes.
