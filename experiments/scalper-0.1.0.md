# Scalper 0.1.0 candidate

Status: isolated implementation, not promoted or deployed. Deterministic rules,
not LLM intelligence. See scalper/README.md for parameters and execution assumptions.

Evidence: 9 engine unit tests passed, main application 26 tests and typecheck
passed. Previous local HTTP smoke: dashboard/state 200, invalid Host 403.
Prior live Kraken runner smoke timed out; no live fill or uptime claim.
No profitability walk-forward study has been run. Required: captured bid/ask,
closed 1-minute bars, arrival/decision times, realistic fees/slippage, chronological
out-of-sample evaluation and complete candidate register. Existing hourly primary
session is unchanged. Faster polling does not justify forced trades.
