/**
 * Atlas deterministic research engine. No wallet signing or venue order API.
 * Candle timestamps are Unix milliseconds at candle OPEN. Callers must supply
 * only fully closed bars. Orders generated on bar N fill at N+1's open.
 * This bar simulator does not model queue position, liquidity or partial fills.
 */
export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }
export interface StrategyConfig {
  fastPeriod: number; slowPeriod: number; feeBps: number; slippageBps: number;
  initialCash: number; maxPositionPct: number; stopLossPct: number; maxDrawdownPct: number;
}
export const defaultConfig: StrategyConfig = {
  fastPeriod: 12, slowPeriod: 36, feeBps: 10, slippageBps: 10,
  initialCash: 10_000, maxPositionPct: 15, stopLossPct: 3, maxDrawdownPct: 8,
};
export const DEFAULT_CONFIG = defaultConfig;
export type TradeAction = 'ENTER' | 'HOLD' | 'EXIT';
export interface AgentAssessment {
  role: 'Research / Context' | 'Challenger' | 'Decision Synthesizer'; engine: 'rules';
  status: 'ready' | 'warning' | 'blocked'; action: TradeAction; summary: string; evidence: string[];
}
export interface AgentEvaluation {
  engine: 'rules'; asOf: number | null; action: TradeAction; reason: string; confidence: null;
  agents: AgentAssessment[];
  indicators: { fastSma: number | null; slowSma: number | null; momentumPct: number; volatilityPct: number };
}
export interface Trade {
  id: string; time: number; side: 'BUY' | 'SELL'; price: number; quantity: number;
  fee: number; reason: string; pnl: number | null;
}
export interface EquityPoint { time: number; equity: number; benchmark: number; drawdownPct: number }
export interface PaperState {
  cash: number; quantity: number; entryPrice: number; positionCost: number;
  equity: number; peakEquity: number; maxDrawdownPct: number; totalFees: number;
  realizedPnl: number; closedTrades: number; wins: number; halted: boolean;
  lastProcessedTime: number | null; pendingAction: TradeAction; pendingReason: string;
  pendingCompletedAt: number | null; pendingExpiresAt: number | null;
  candleIntervalMs: number;
  benchmarkQuantity: number; benchmarkCash: number; trades: Trade[]; equityCurve: EquityPoint[];
  latestDecision: AgentEvaluation | null; status: 'ready' | 'warming-up' | 'data-gap' | 'halted';
}
export interface BacktestResult {
  equityCurve: EquityPoint[]; trades: Trade[];
  metrics: { returnPct: number; maxDrawdownPct: number; winRate: number; trades: number; totalFees: number; finalEquity: number; benchmarkReturnPct: number; realizedPnl: number };
  agents: AgentEvaluation;
  provenance: { engine: string; execution: string; benchmark: string; limitations: string[]; bars: number; startTime: number; endTime: number };
}

export function validateConfig(config: StrategyConfig): StrategyConfig {
  const bounds: [keyof StrategyConfig, number, number][] = [
    ['fastPeriod', 2, 500], ['slowPeriod', 3, 1_000], ['feeBps', 0, 500], ['slippageBps', 0, 1_000],
    ['initialCash', 1, 100_000_000], ['maxPositionPct', 0.1, 100], ['stopLossPct', 0.1, 50], ['maxDrawdownPct', 0.1, 90],
  ];
  for (const [key, min, max] of bounds) {
    const value = config[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${key} must be between ${min} and ${max}.`);
  }
  if (!Number.isInteger(config.fastPeriod) || !Number.isInteger(config.slowPeriod)) throw new Error('Indicator periods must be whole numbers.');
  if (config.fastPeriod >= config.slowPeriod) throw new Error('fastPeriod must be smaller than slowPeriod.');
  return { ...config };
}

export function validateCandles(candles: Candle[]): void {
  let prior = -Infinity;
  for (const candle of candles) {
    if (!Number.isSafeInteger(candle.time) || candle.time < 0 || candle.time <= prior) throw new Error('Candles must have unique, increasing Unix-millisecond timestamps.');
    for (const field of ['open', 'high', 'low', 'close'] as const) if (!Number.isFinite(candle[field]) || candle[field] <= 0) throw new Error(`Invalid candle ${field}.`);
    if (!Number.isFinite(candle.volume) || candle.volume < 0) throw new Error('Candle volume must be non-negative.');
    if (candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close) || candle.high < candle.low) throw new Error('OHLC candle range is invalid.');
    prior = candle.time;
  }
}

/** Explicitly synthetic; the seed and fixed start date make demo runs reproducible. */
export function generateSampleCandles(symbol = 'ETH', count = 720, seed = 42): Candle[] {
  if (!Number.isInteger(count) || count < 2 || count > 20_000) throw new Error('Sample count must be 2-20000.');
  let rng = seed >>> 0;
  const random = () => { rng = (Math.imul(1664525, rng) + 1013904223) >>> 0; return rng / 4294967296; };
  let close = symbol.toUpperCase().includes('BTC') ? 74_000 : 2_600;
  return Array.from({ length: count }, (_, index) => {
    const open = close;
    const regime = Math.sin(index / 57) * 0.002 + Math.sin(index / 17) * 0.0006;
    close = Math.max(1, open * (1 + regime + (random() - 0.5) * 0.012));
    const wick = 0.001 + random() * 0.005;
    return { time: Date.UTC(2026, 0, 1) + index * 3_600_000, open, close,
      high: Math.max(open, close) * (1 + wick), low: Math.min(open, close) * (1 - wick), volume: 80 + random() * 900 };
  });
}

const average = (numbers: number[]) => numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
function intervalOf(candles: Candle[]): number {
  if (candles.length < 2) return 3_600_000;
  const window = candles.slice(-33);
  const deltas = window.slice(1).map((c, i) => c.time - window[i].time).sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)];
}

export function evaluateAgents(candles: Candle[], inputConfig: StrategyConfig = defaultConfig): AgentEvaluation {
  const config = validateConfig(inputConfig);
  const last = candles.at(-1);
  const warm = candles.length < config.slowPeriod;
  const closes = candles.slice(-Math.max(config.slowPeriod, 24)).map(c => c.close);
  const fastSma = candles.length >= config.fastPeriod ? average(closes.slice(-config.fastPeriod)) : null;
  const slowSma = !warm ? average(closes.slice(-config.slowPeriod)) : null;
  const returnWindow = candles.slice(-Math.min(24, candles.length));
  const returns = returnWindow.slice(1).map((c, i) => c.close / returnWindow[i].close - 1);
  const returnMean = returns.length ? average(returns) : 0;
  const volatilityPct = returns.length ? Math.sqrt(average(returns.map(r => (r - returnMean) ** 2))) * 100 : 0;
  const momentumPct = returnWindow.length > 1 ? (last!.close / returnWindow[0].close - 1) * 100 : 0;
  const trend = !warm && fastSma !== null && slowSma !== null ? (fastSma / slowSma - 1) * 100 : 0;
  const excessiveVolatility = volatilityPct > 5;
  const action: TradeAction = warm || excessiveVolatility ? 'HOLD' : trend > 0.1 ? 'ENTER' : trend < -0.1 ? 'EXIT' : 'HOLD';
  const reason = warm ? `Need ${config.slowPeriod} closed candles; received ${candles.length}.` : excessiveVolatility ? 'Volatility exceeds the 5% per-bar research gate.' : action === 'ENTER' ? 'Fast moving average is above slow average; trend candidate.' : action === 'EXIT' ? 'Fast moving average is below slow average; exit candidate.' : 'Moving averages are within the neutral band.';
  const evidence = warm ? [`Closed candles: ${candles.length}/${config.slowPeriod}`] : [`SMA ${config.fastPeriod}: ${fastSma!.toFixed(2)}`, `SMA ${config.slowPeriod}: ${slowSma!.toFixed(2)}`, `Trend spread: ${trend.toFixed(2)}%`];
  const agents: AgentAssessment[] = [
    { role: 'Research / Context', engine: 'rules', status: warm ? 'blocked' : 'ready', action, summary: warm ? 'Waiting for indicator warm-up.' : 'Closed-candle trend and momentum assessment. No news or LLM inference was used.', evidence },
    { role: 'Challenger', engine: 'rules', status: warm || excessiveVolatility ? 'blocked' : 'warning', action: warm || excessiveVolatility ? 'HOLD' : action, summary: excessiveVolatility ? 'Volatility gate blocks new entries.' : 'A trend signal can fail in sideways markets. Fees, execution assumptions and concentration remain relevant.', evidence: [`Per-bar volatility: ${volatilityPct.toFixed(2)}%`, `Position cap: ${config.maxPositionPct}%`, 'Rule-based review; not an independent AI opinion.'] },
    { role: 'Decision Synthesizer', engine: 'rules', status: warm || excessiveVolatility ? 'blocked' : 'ready', action, summary: reason, evidence: ['Proposal only; deterministic risk checks still apply.', 'No calibrated probability of profit is asserted.'] },
  ];
  return { engine: 'rules', asOf: last ? last.time + intervalOf(candles) : null, action, reason, confidence: null, agents, indicators: { fastSma, slowSma, momentumPct, volatilityPct } };
}

export function createPaperState(inputConfig: StrategyConfig = defaultConfig): PaperState {
  const config = validateConfig(inputConfig);
  return { cash: config.initialCash, quantity: 0, entryPrice: 0, positionCost: 0, equity: config.initialCash,
    peakEquity: config.initialCash, maxDrawdownPct: 0, totalFees: 0, realizedPnl: 0, closedTrades: 0, wins: 0,
    halted: false, lastProcessedTime: null, pendingAction: 'HOLD', pendingReason: 'Waiting for a closed-candle snapshot.',
    pendingCompletedAt: null, pendingExpiresAt: null,
    candleIntervalMs: 3_600_000,
    benchmarkQuantity: 0, benchmarkCash: config.initialCash, trades: [], equityCurve: [], latestDecision: null, status: 'warming-up' };
}

function buy(state: PaperState, rawPrice: number, time: number, config: StrategyConfig, reason: string) {
  if (state.quantity > 0 || state.halted) return;
  const price = rawPrice * (1 + config.slippageBps / 10_000);
  const budget = Math.min(state.cash, (state.cash + state.quantity * rawPrice) * config.maxPositionPct / 100);
  const notional = budget / (1 + config.feeBps / 10_000);
  const fee = notional * config.feeBps / 10_000;
  if (notional <= 0) return;
  state.quantity = notional / price; state.entryPrice = price; state.positionCost = notional + fee;
  state.cash -= state.positionCost; state.totalFees += fee;
  state.trades.push({ id: `paper-${time}-buy-${state.trades.length}`, time, side: 'BUY', price, quantity: state.quantity, fee, reason, pnl: null });
}

function sell(state: PaperState, rawPrice: number, time: number, config: StrategyConfig, reason: string) {
  if (state.quantity <= 0) return;
  const price = rawPrice * (1 - config.slippageBps / 10_000);
  const notional = state.quantity * price; const fee = notional * config.feeBps / 10_000;
  const pnl = notional - fee - state.positionCost;
  state.cash += notional - fee; state.totalFees += fee; state.realizedPnl += pnl;
  state.closedTrades++; if (pnl > 0) state.wins++;
  state.trades.push({ id: `paper-${time}-sell-${state.trades.length}`, time, side: 'SELL', price, quantity: state.quantity, fee, reason, pnl });
  state.quantity = 0; state.entryPrice = 0; state.positionCost = 0;
}

function processBar(state: PaperState, candle: Candle, history: Candle[], config: StrategyConfig, decisionCompletedAt?: number) {
  const eligible = state.pendingCompletedAt === null || candle.time >= state.pendingCompletedAt;
  const expired = state.pendingExpiresAt !== null && candle.time > state.pendingExpiresAt;
  // A pending proposal is retained until the first open at/after its actual
  // completion time. Replacing it every hourly poll would otherwise starve it.
  const deferred = !eligible && !expired && ((state.pendingAction === 'ENTER' && state.quantity === 0) || (state.pendingAction === 'EXIT' && state.quantity > 0));
  if (eligible && !expired && state.pendingAction === 'EXIT') sell(state, candle.open, candle.time, config, state.pendingReason);
  else if (eligible && !expired && state.pendingAction === 'ENTER') buy(state, candle.open, candle.time, config, state.pendingReason);
  if (state.quantity > 0) {
    const stop = state.entryPrice * (1 - config.stopLossPct / 100);
    if (candle.low <= stop) sell(state, Math.min(candle.open, stop), candle.time, config, 'Stop-loss; candle fill assumption with gap protection.');
  }
  state.equity = state.cash + state.quantity * candle.close;
  state.peakEquity = Math.max(state.peakEquity, state.equity);
  const drawdownPct = (1 - state.equity / state.peakEquity) * 100;
  state.maxDrawdownPct = Math.max(state.maxDrawdownPct, drawdownPct);
  if (drawdownPct >= config.maxDrawdownPct) state.halted = true;
  state.latestDecision = evaluateAgents(history, config);
  if (!deferred || (state.halted && state.pendingAction !== 'EXIT')) {
    state.pendingAction = state.halted ? (state.quantity > 0 ? 'EXIT' : 'HOLD') : state.latestDecision.action;
    state.pendingReason = state.halted ? 'Drawdown circuit breaker: close at next eligible candle open; no new entry.' : state.latestDecision.reason;
    state.pendingCompletedAt = decisionCompletedAt ?? candle.time + intervalOf(history);
    state.pendingExpiresAt = state.pendingCompletedAt + 3 * intervalOf(history);
  }
  state.lastProcessedTime = candle.time;
  state.status = state.halted ? 'halted' : history.length < config.slowPeriod ? 'warming-up' : 'ready';
  state.equityCurve.push({ time: candle.time, equity: state.equity, benchmark: state.benchmarkCash + state.benchmarkQuantity * candle.close, drawdownPct });
}

/**
 * First call primes the latest closed-candle decision without retrospective trades.
 * Subsequent calls process only newer bars. Replaying identical data is idempotent.
 * If missed bars cannot be reconstructed, execution is skipped until a fresh cycle.
 */
export function paperStep(inputState: PaperState, candles: Candle[], inputConfig: StrategyConfig = defaultConfig, processedAt = Date.now()): PaperState {
  const config = validateConfig(inputConfig); validateCandles(candles);
  if (!Number.isSafeInteger(processedAt) || processedAt < 0) throw new Error('processedAt must be a valid Unix-millisecond timestamp.');
  const state: PaperState = structuredClone(inputState);
  if (!candles.length) return state;
  const latest = candles[candles.length - 1];
  const interval = state.lastProcessedTime === null ? intervalOf(candles) : state.candleIntervalMs;
  if (latest.time + interval > processedAt) throw new Error('Paper simulation only accepts candles that were fully closed at processing time.');
  if (state.lastProcessedTime === null) {
    state.candleIntervalMs = interval;
    state.latestDecision = evaluateAgents(candles, config);
    state.pendingAction = state.latestDecision.action; state.pendingReason = state.latestDecision.reason;
    state.pendingCompletedAt = processedAt; state.pendingExpiresAt = processedAt + 3 * intervalOf(candles);
    state.lastProcessedTime = latest.time;
    state.benchmarkQuantity = config.initialCash / latest.close; state.benchmarkCash = 0;
    state.status = candles.length < config.slowPeriod ? 'warming-up' : 'ready';
    state.equityCurve.push({ time: latest.time, equity: state.equity, benchmark: config.initialCash, drawdownPct: 0 });
    return state;
  }
  const nextIndex = candles.findIndex(c => c.time > state.lastProcessedTime!);
  if (nextIndex === -1) return state;
  const gap = candles[nextIndex].time - state.lastProcessedTime;
  const internalGap = candles.slice(nextIndex + 1).some((c, index) => c.time - candles[nextIndex + index].time > interval * 1.5);
  if (gap > interval * 1.5 || internalGap) {
    state.pendingAction = 'HOLD'; state.pendingReason = 'Data gap: execution paused; backfill missing candles before resuming.';
    state.pendingCompletedAt = processedAt; state.pendingExpiresAt = processedAt + 3 * interval;
    state.latestDecision = evaluateAgents(candles, config); state.status = 'data-gap';
    state.equity = state.cash + state.quantity * latest.close;
    return state;
  }
  for (let i = nextIndex; i < candles.length; i++) processBar(state, candles[i], candles.slice(Math.max(0, i + 1 - Math.max(config.slowPeriod, 24)), i + 1), config, processedAt);
  state.trades = state.trades.slice(-2_000); state.equityCurve = state.equityCurve.slice(-2_000);
  return state;
}

export function startPaperFromHistory(candles: Candle[], config: StrategyConfig = defaultConfig, startedAt = Date.now()): PaperState {
  return paperStep(createPaperState(config), candles, config, startedAt);
}

/** Safely replace a rule proposal with an externally evaluated proposal. */
export function setPaperProposal(inputState: PaperState, action: TradeAction, reason: string, completedAt = Date.now()): PaperState {
  if (!['ENTER', 'HOLD', 'EXIT'].includes(action)) throw new Error('Unsupported paper action.');
  if (!Number.isSafeInteger(completedAt) || completedAt < 0) throw new Error('Invalid decision completion time.');
  const state = structuredClone(inputState);
  state.pendingAction = state.halted && action === 'ENTER' ? 'HOLD' : action;
  state.pendingReason = reason.slice(0, 2_000);
  state.pendingCompletedAt = completedAt;
  state.pendingExpiresAt = completedAt + 3 * state.candleIntervalMs;
  return state;
}

export function runBacktest(candles: Candle[], inputConfig: StrategyConfig = defaultConfig): BacktestResult {
  const config = validateConfig(inputConfig); validateCandles(candles);
  if (candles.length < config.slowPeriod + 2) throw new Error(`Need at least ${config.slowPeriod + 2} closed candles for this backtest.`);
  if (candles.length > 20_000) throw new Error('Backtest is limited to 20000 bars per request.');
  const interval = intervalOf(candles);
  if (candles.slice(1).some((c, i) => c.time - candles[i].time !== interval)) throw new Error('Backtest data has gaps or irregular candle intervals. Repair the dataset first.');
  const state = createPaperState(config);
  const start = config.slowPeriod;
  const firstPrice = candles[start].open * (1 + config.slippageBps / 10_000);
  state.benchmarkQuantity = config.initialCash / (1 + config.feeBps / 10_000) / firstPrice; state.benchmarkCash = 0;
  state.latestDecision = evaluateAgents(candles.slice(0, start), config); state.pendingAction = state.latestDecision.action; state.pendingReason = state.latestDecision.reason;
  for (let i = start; i < candles.length; i++) processBar(state, candles[i], candles.slice(Math.max(0, i + 1 - Math.max(config.slowPeriod, 24)), i + 1), config);
  const benchmark = state.equityCurve.at(-1)!.benchmark;
  return {
    equityCurve: state.equityCurve, trades: state.trades,
    metrics: { returnPct: (state.equity / config.initialCash - 1) * 100, maxDrawdownPct: state.maxDrawdownPct,
      winRate: state.closedTrades ? state.wins / state.closedTrades * 100 : 0, trades: state.closedTrades, totalFees: state.totalFees,
      finalEquity: state.equity, benchmarkReturnPct: (benchmark / config.initialCash - 1) * 100, realizedPnl: state.realizedPnl },
    agents: state.latestDecision!,
    provenance: { engine: 'Atlas deterministic SMA trend / rule-based role simulation', execution: 'Next-bar open; adverse slippage and fees on both sides; intrabar stops use conservative gap-aware fills.', benchmark: '100% buy-and-hold from first tradable bar; entry costs included; final position marked to market; not exposure matched.', limitations: ['No LLM inference or live orders.', 'OHLC bars do not reveal intrabar paths, order queue, liquidity, partial fills or market impact.', 'Gas and MEV are not modeled; results do not establish DEX execution performance.', 'Unclosed positions are marked to market, not forcibly liquidated.'], bars: candles.length, startTime: candles[start].time, endTime: candles.at(-1)!.time },
  };
}
