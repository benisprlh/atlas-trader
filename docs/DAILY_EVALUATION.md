# Daily evaluation contract

Report in Indonesian on every evaluation run, including zero-trade runs. Seek
net profit after costs with controlled drawdown and exposure; do not promise
profit or interpret zero trades as evidence of safety.

Read Site metadata and verify owner-private access. Use the current supported
Sites service credential in memory only for GET /api/state. This workflow is
read-only: the hourly tick updater is separate. On access failure reread metadata
once; report unresolved blockers without changing access or session state.

Primary session: 35c81bc0-26c6-4174-8b3e-e4e416e22767. Initial virtual cash:
USD 10,000. Main period: 6 November to 6 December 2026. Compare enrollment and
prior snapshots. Report missing, paused or changed sessions without repair.

Compute available 24-hour and cumulative equity, net simulated PnL/return,
realized/unrealized PnL, trading fees, drawdown, positions/exposure, closed trades,
win rate and cash/buy-and-hold benchmarks. Separate API costs from simulated fees;
missing values are unavailable, not zero. Inspect heartbeat, Kraken provenance,
data gaps, session.error, latest modelReview and risk limits. Do not annualize.

Use reports/YYYY-MM-DD.md, data/snapshots/YYYY-MM-DD/<session-id>.json,
research/ and experiments/. Check for existing files before writing. Never replace
an archived snapshot. Additional same-day captures use an explicit time suffix;
append report sections rather than silently rewriting history. Include capture
WIB time, source filename and provenance. Only visible retained data is archived:
2,000 equity/trade entries, 250 events and latest AI review. Do not claim a complete
hourly review archive. Never replace failed market data with synthetic prices.

Research 1-3 targeted hypotheses from primary sources with links, benefit, risk
and preregistered pass criteria. Test only isolated data copies with chronological
out-of-sample/walk-forward splits, realistic fees/slippage and no look-ahead.
Log every candidate, including failures and unrun experiments with exact missing
inputs. Separate backtest results from forward-paper results. From 6 December,
include a month recap without deleting/resetting data; continue until told to stop.

Repository visibility was explicitly allowed to remain public on 10 November 2026.
Before each upload scan for credentials and personal identifiers. Commit checked
updates to main, or use a PR if protection requires it; verify the remote commit.
Repository publication never authorizes publication of the hosted Site.
