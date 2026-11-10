# Atlas Scalper Paper — experimental 0.1.0

This is a NEW isolated virtual experiment, not a replacement for the frozen
Nov 6–Dec 6 Atlas session. No existing Site endpoint, strategy, database,
scheduler or AI prompt is changed. No exchange key, wallet, signer or real
order endpoint exists in this runner. It must NOT be represented as live trading.

## What it does

- ETH/USD Kraken public REST: confirmed 1-minute bars, bid/ask polling every
  15 seconds AFTER the previous request finishes (not a latency guarantee).
- Signal agent: five-bar breakout or rebound, SMA5 > SMA20. Evaluate once per
  new closed candle; open positions monitored on each quote cycle.
- Cost/risk agent: reject wide spreads, stale/invalid feeds, incomplete bars,
  or estimated movement proxy <= roundtrip cost + 10 bps. ATR is a volatility
  proxy, not a forecast or calibrated probability of profit.
- Execution simulator: buy ask + slippage, sell bid - slippage, charge both fees;
  stop 30 bps, ATR-based target, maximum holding time 5 minutes, cooldown 1 minute.
- Risk: max 10% position including entry fee, max 30 entries/UTC day, block new
  entries at 1% daily loss, permanent 3% drawdown halt. Stops are checked on
  polled quotes, NOT guaranteed prices. On a feed outage the position stays
  marked at last known price and cannot be simulated closed until data resumes.
- Audit: SQLite WAL/FULL; append-only cycles and fills embedded in each cycle,
  recovery from the last committed state on restart. Back up the data directory
  using SQLite backup, or stop service and copy database and WAL together.
- Local read-only dashboard shows fills, fees, decisions and blocks. No browser
  needs to be open for the runner to operate.

These agents are deterministic rules, **not LLM agents**. The existing hourly
Atlas AI is unchanged. Adding AI strategy selection/review and running temporal
out-of-sample profitability validation remain separate work. No claim of profit,
validated edge, or continuous fills is made. No minimum trade quota is imposed.

## Run (Node.js 24+; no npm dependencies)

Extract this directory on your VPS. Run tests first:

```bash
node --test engine.test.mjs
node runner.mjs
```

Default dashboard: http://127.0.0.1:8788. It intentionally has no public listener.
For access from your computer:

```bash
ssh -L 8788:127.0.0.1:8788 YOUR_VPS_USER@YOUR_VPS_HOST
```

Open http://localhost:8788. For access without SSH, use an authenticated TLS
reverse proxy or private network; that deployment is not included or verified.
Never expose this unauthenticated localhost dashboard directly to the internet.

## Persistent service on Linux VPS

Requires an actual VPS deployment; leaving a ChatGPT scratch process running is
not a 24/7 deployment. Assuming Node24 is installed at /usr/bin/node:

```bash
sudo useradd --system --home /opt/atlas-scalper --shell /usr/sbin/nologin atlas
sudo mkdir -p /opt/atlas-scalper
sudo cp engine.mjs runner.mjs dashboard.html /opt/atlas-scalper/
sudo cp atlas-scalper.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now atlas-scalper
sudo systemctl status atlas-scalper --no-pager
sudo journalctl -u atlas-scalper -n 30 --no-pager
```

If the atlas user already exists, skip useradd. Adjust ExecStart to the installed
Node24 path. Persistent history lives in /var/lib/atlas-scalper. Stop/start
preserves state. A changed configuration fails closed: use another data directory
for a separate experiment; never delete/overwrite prior results.

## Cost assumptions and limitations

Default fee80bps PER LEG is a conservative Tier1 taker scenario from Kraken's
current Spot Crypto table, not a verified account fee. Slippage10bps per leg is
an assumption; bid/ask spread is also charged. Do not secretly lower fees to
manufacture frequent/profitable trades. At this tier many minute setups may be
blocked: roundtrip fee alone is ~1.6% of traded notional. A profitable scalper
cannot be inferred from fast polling. Set SCALPER_CONFIG to a JSON file only
for a separately named experiment with documented fee evidence.

REST ticker has no exchange quote timestamp: quoteAt is local receipt time,
so provider-side quote freshness is not proven. No depth, queue, partial fills,
latency distribution, borrowing, gas, or API/hosting costs are modeled. A future
WebSocket BBO adapter should use exchange timestamps and recorded depth.

Sources checked 10 Nov 2026:
- https://docs.kraken.com/api-reference/market-data/get-ohlc-data
- https://docs.kraken.com/api-reference/market-data/get-ticker-information
- https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/ticker
- https://www.kraken.com/features/fee-schedule

Tests use synthetic fixtures ONLY for correctness, never as performance results.
This package has not passed walk-forward profitability evaluation. Record all
candidate configurations and failed runs. Current main session is not touched.
