# Atlas Trader

Public source repository, authorized by Beni on 10 November 2026. The hosted
Site remains owner-private; repository visibility does not change Site access.

## Scalper candidate status

See [scalper/README.md](scalper/README.md) for the separate Node 24+ paper scalper.
It polls Kraken quotes and closed one-minute candles and uses deterministic rules.
It has no LLM integration, signer or real-money execution. It is not deployed or
running continuously. Unit tests pass; the live Kraken smoke attempt timed out.
No live fills or profitability are claimed. The original hourly session is unchanged.

Archived evaluation: [10 November 2026](reports/2026-11-10.md), captured at
08:32 WIB; this is historical evidence, not the latest live balance.


Private crypto research workbench for Beni Saprulah: backtests, automated paper
sessions, three analyst roles, risk controls, and a non-custodial wallet view.

## Implemented

- Reproducible synthetic backtests and recent hourly Kraken BTC/USD or ETH/USD
  backtests with provenance, fees, slippage, stops, position cap and drawdown halt.
- Persistent paper state. Historical startup data is only used for warm-up.
  Decisions cannot be filled before they actually existed; repeated candles
  cannot produce duplicate orders.
- Three rule-based roles by default. Optional actual OpenAI/DeepSeek review has
  strict evidence validation and can veto entries, never create extra exposure
  or suppress deterministic exits.
- EIP-6963/injected EVM wallet discovery and user-initiated read-only connection.
  No seed phrase, key, approval, signing or broadcasting is requested.
- Unsigned Base WETH/USDC permission-policy drafts. Saving or exporting a draft
  grants no on-chain rights.
- Private dashboard, D1 persistence and an unattended hourly paper updater.

## Current boundaries

`liveTrading` is always false. Smart-account deployment, delegated execution,
protected session signing and DEX transaction submission are **not implemented
or activated**. Wallet connection does not enable unattended financial trading.
No on-chain permission has been granted by this application. An audited adapter
and an explicit wallet-owner grant are prerequisites for that separate phase.

The Web3-oriented prototype uses a TypeScript research engine, rather than the
Freqtrade exchange-account engine in the preceding research blueprint. Kraken
prices are a CEX proxy. Gas, MEV, pool liquidity, partial fills and market impact
are not modeled. Recent candles are not a multiyear walk-forward study. Historical
validation and exposure-matched benchmarks remain future work. The displayed
benchmark is 100% buy-and-hold. Simulated results are not claims of future returns.

The scheduler is an hourly cloud task, not a low-latency daemon or uptime SLA.
Once registered, it works while the browser is closed. A running paper session
is required; absent/paused sessions only update the heartbeat. Snapshot history
retains the latest 2,000 trade and equity records; export records regularly for a
long-term audit. Current balances and cumulative metrics survive truncation.

## Development and verification

Requires Node 22.13+. Run `npm ci`, then `npm run dev` in a normal environment.
Use `npm test`, `npm run typecheck`, and `npm run build` for verification.

The Sites/Vinext deployment integration is preserved. D1 uses binding `DB`.
Generate schema migrations with `npm run db:generate`. Local migrations use the
generated `dist/server/wrangler.json` and `.wrangler/state`; hosted migrations are
applied at publication. See `docs/STARTER.md` for the complete starter workflow.

## Model configuration

Configure in the host's secret store, never in browser inputs or Git:

| Variable | Purpose |
| --- | --- |
| `ANALYST_API_KEY` | Server-only model provider credential |
| `ANALYST_MODEL` | Exact model ID; OpenAI uses Responses reasoning (e.g. gpt-6.1-sol) |
| `ANALYST_API_URL` | Optional approved OpenAI/DeepSeek endpoint |

The default endpoint is OpenAI chat completions; DeepSeek is supported through
`https://api.deepseek.com/chat/completions`. OpenAI uses the Responses API with strict structured output, medium reasoning, and a shared ninety-second review deadline. Other hosts are rejected. Missing
key/model is explicitly rule-based mode. Provider errors abstain from entry and
preserve protective exits. Current evidence is numerical candles; no news
ingestion is claimed. No model provider has been configured by default.

## API

| Route | Behavior |
| --- | --- |
| `GET /api/health` | Version and paper-only capability status |
| `GET /api/state` | Session, backtests, events and scheduler status |
| `GET /api/market?symbol=ETH` | Recent fully closed price candles |
| `POST /api/backtest` | `{symbol, source:'sample'|'live', config}` |
| `POST /api/paper` | `{action:'start'|'pause'|'tick'|'reset', symbol, config}` |
| `POST /api/settings` | Save next-experiment risk and unsigned permission drafts |
| `POST /api/scheduled-tick` | Owner-private unattended updater |

Writes use compare-and-swap revisions; concurrent ticks cannot both commit a
paper order. Pause freezes simulation but retains virtual positions. Reset is
allowed only while paused. Neither is an on-chain close or revocation operation.

## Security

This is a single-owner private deployment. Sites authenticates the owner or a
scoped service caller before shared workspace routes are reached. Mutations
reject cross-origin browser requests. Do not make the Site public or add viewers
without implementing per-user authorization and record isolation. A standalone
host must supply equivalent authentication. Never expose the raw dev server.

There is no financial signer. Wallet addresses are not used as ownership proof
or server authorization. Secrets and runtime state are Git-ignored. Model outputs
cannot invoke tools or change limits. Permission drafts are not authorization.

## Layout

- `app/page.tsx`: dashboard
- `lib/trading.ts`: backtest/paper engine
- `lib/agent-provider.ts`: actual optional three-role LLM review
- `lib/delegation-policy.ts`: inactive permission policy validation
- `lib/market.ts`: provider, closed-candle and freshness checks
- `lib/paper-service.ts`: paper state and review integration
- `db/`, `drizzle/`: schema and migrations
- `tests/`: leakage, financial state, provider and permission tests
- `docs/UNATTENDED.md`: updater contract

References: https://docs.metamask.io/smart-accounts-kit/ ;
https://www.freqtrade.io/en/stable/backtesting/ ;
https://arxiv.org/abs/2504.14765 .
