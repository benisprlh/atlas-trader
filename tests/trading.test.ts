import { test } from 'node:test';
import assert from 'node:assert/strict';
// Node 24 executes TypeScript directly; no network or test-framework dependency.
// @ts-ignore Node's native TypeScript loader requires the .ts extension.
import { createPaperState, defaultConfig, evaluateAgents, generateSampleCandles, paperStep, runBacktest, validateConfig } from '../lib/trading.ts';
// @ts-ignore Node's native TypeScript loader requires the .ts extension.
import type { Candle, StrategyConfig } from '../lib/trading.ts';

const config: StrategyConfig = { ...defaultConfig, fastPeriod: 2, slowPeriod: 3, maxPositionPct: 25 };
const bars = (prices: number[]): Candle[] => prices.map((close, i) => ({ time: Date.UTC(2026, 0, 1) + i * 3_600_000, open: close, high: close * 1.001, low: close * 0.999, close, volume: 100 }));
const near = (a: number, b: number, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test('validates finite risk limits and indicator periods', () => {
  assert.throws(() => validateConfig({ ...config, fastPeriod: 3 }));
  assert.throws(() => validateConfig({ ...config, fastPeriod: 2.5 }));
  assert.throws(() => validateConfig({ ...config, initialCash: NaN }));
  assert.throws(() => validateConfig({ ...config, maxPositionPct: 101 }));
  assert.throws(() => validateConfig({ ...config, feeBps: -1 }));
});

test('synthetic data is deterministic and valid, without fabricated LLM claims', () => {
  const sample = generateSampleCandles('ETH', 120, 42);
  assert.deepEqual(sample, generateSampleCandles('ETH', 120, 42));
  assert.notDeepEqual(sample, generateSampleCandles('ETH', 120, 43));
  const result = runBacktest(sample);
  assert.equal(result.agents.engine, 'rules');
  assert.equal(result.agents.confidence, null);
  assert.equal(result.agents.agents.length, 3);
  assert.ok(result.provenance.limitations.some((x: string) => x.includes('Gas')));
});

test('flat prices stay in cash without phantom gains or fees', () => {
  const result = runBacktest(bars(Array(40).fill(100)), config);
  near(result.metrics.finalEquity, config.initialCash);
  assert.equal(result.trades.length, 0);
  near(result.metrics.totalFees, 0);
});

test('decisions cannot use future bars; result prefixes are identical', () => {
  const sample = generateSampleCandles('BTC', 240, 31);
  const short = runBacktest(sample.slice(0, 180));
  const long = runBacktest(sample);
  assert.deepEqual(short.equityCurve, long.equityCurve.slice(0, short.equityCurve.length));
  assert.deepEqual(short.trades, long.trades.filter((t: {time:number}) => t.time <= sample[179].time));
});

test('fills at next bar open and caps total entry cost including fee', () => {
  const sample = bars([100, 101, 102, 105, 106, 107]);
  const result = runBacktest(sample, config);
  const entry = result.trades.find((t: {side:string}) => t.side === 'BUY')!;
  assert.equal(entry.time, sample[3].time);
  near(entry.price, sample[3].open * (1 + config.slippageBps / 10_000));
  near(entry.price * entry.quantity + entry.fee, config.initialCash * config.maxPositionPct / 100);
  assert.ok(result.equityCurve.every((point: {equity:number}) => Number.isFinite(point.equity)));
});

test('cash conservation includes both fees and realized roundtrip PnL', () => {
  const sample = bars([100, 101, 102, 103, 104, 105, 99, 98, 97, 96]);
  const result = runBacktest(sample, { ...config, stopLossPct: 50 });
  assert.ok(result.trades.some((t: {side:string}) => t.side === 'SELL'));
  near(result.metrics.totalFees, result.trades.reduce((n:number,t:{fee:number}) => n + t.fee, 0));
  near(result.metrics.finalEquity, config.initialCash + result.metrics.realizedPnl);
  const entry = result.trades.find((t: {side:string}) => t.side === 'BUY')!;
  const exit = result.trades.find((t: {side:string}) => t.side === 'SELL')!;
  near(exit.pnl!, (exit.price-entry.price)*entry.quantity-entry.fee-exit.fee);
});

test('gap below stop fills at adverse opening price, not an optimistic stop', () => {
  const sample = bars([100, 101, 102, 103, 90, 89, 88]);
  const result = runBacktest(sample, config);
  const exit = result.trades.find((t: {side:string}) => t.side === 'SELL')!;
  assert.ok(exit.reason.includes('Stop-loss'));
  near(exit.price, 90 * (1 - config.slippageBps / 10_000));
});

test('paper warm-start does not invent historical trades; duplicate candles are idempotent', () => {
  const sample = bars([100,101,102,103,104,105]);
  const blank = createPaperState(config);
  const primed = paperStep(blank, sample.slice(0,4), config, sample[4].time);
  assert.equal(primed.trades.length, 0);
  assert.equal(blank.lastProcessedTime, null);
  const next = paperStep(primed, sample.slice(0,5), config, sample[5].time);
  assert.equal(next.trades.filter((t:{side:string}) => t.side==='BUY').length, 1);
  assert.deepEqual(next, paperStep(next, sample.slice(0,5), config, sample[5].time));
  assert.equal(primed.trades.length, 0);
});

test('paper rejects unobservable gap execution and never duplicates a buy', () => {
  const sample = bars([100,101,102,103,104,105,106,107,108]);
  const primed = paperStep(createPaperState(config), sample.slice(0,4), config);
  const gap = paperStep(primed, sample.slice(5), config);
  assert.equal(gap.status, 'data-gap');
  assert.equal(gap.trades.length, 0);
  assert.equal(gap.pendingAction, 'HOLD');
});

test('paper never backdates a fill before the actual decision completed', () => {
  const sample = bars([100,101,102,103,104,105,106,107]);
  const completedAt = sample[4].time + 7 * 60_000;
  const primed = paperStep(createPaperState(config), sample.slice(0,4), config, completedAt);
  const tooEarly = paperStep(primed, sample.slice(0,5), config, sample[5].time + 7 * 60_000);
  assert.equal(tooEarly.trades.length, 0);
  const eligible = paperStep(tooEarly, sample.slice(0,6), config, sample[6].time + 7 * 60_000);
  assert.equal(eligible.trades.length, 1);
  assert.equal(eligible.trades[0].time, sample[5].time);
  assert.ok(eligible.trades[0].time >= completedAt);
});

test('catch-up never creates new entries from decisions generated after historical bars', () => {
  const sample = bars([100,100,100,100,101,102,103,104,105,106]);
  const primed = paperStep(createPaperState(config), sample.slice(0,4), config, sample[4].time);
  assert.equal(primed.pendingAction,'HOLD');
  const caughtUp = paperStep(primed, sample, config, sample.at(-1)!.time + 3_600_000);
  assert.equal(caughtUp.trades.length,0);
  assert.equal(caughtUp.pendingAction,'ENTER');
  assert.equal(caughtUp.pendingCompletedAt,sample.at(-1)!.time + 3_600_000);
});

test('paper rejects an unfinished candle', () => {
  const sample = bars([100,101,102,103]);
  assert.throws(()=>paperStep(createPaperState(config),sample,config,sample[3].time+60_000));
});

test('a halted portfolio retains its deferred EXIT until eligible rather than starving it', () => {
  const sample = bars([100,101,102,103,104,105,106]);
  const completedAt=sample[4].time+7*60_000;
  const state=paperStep(createPaperState(config),sample.slice(0,4),config,completedAt);
  Object.assign(state,{quantity:10,cash:9000,entryPrice:100,positionCost:1000,halted:true,pendingAction:'EXIT'});
  const deferred=paperStep(state,sample.slice(0,5),config,sample[5].time+7*60_000);
  assert.equal(deferred.pendingCompletedAt,completedAt);
  assert.equal(deferred.quantity,10);
  const executed=paperStep(deferred,sample.slice(0,6),config,sample[6].time+7*60_000);
  assert.equal(executed.quantity,0);
  assert.equal(executed.trades.filter((t:{side:string})=>t.side==='SELL').length,1);
});

test('drawdown breaker prevents later re-entry and closes existing position next open', () => {
  const sample = bars([100,101,102,103,104,90,89,90,95,101,104,110]);
  const result = runBacktest(sample, { ...config, maxDrawdownPct: 0.5, stopLossPct: 50 });
  assert.equal(result.trades.filter((t:{side:string})=>t.side==='BUY').length, 1);
  assert.ok(result.trades.some((t:{reason:string})=>t.reason.includes('Drawdown')));
});

test('rejects malformed OHLC, duplicates and gaps rather than producing misleading metrics', () => {
  const sample = bars([100,101,102,103,104,105]);
  assert.throws(()=>runBacktest([sample[0],sample[0],...sample.slice(2)],config));
  assert.throws(()=>runBacktest(sample.map((c,i)=>i===3?{...c,high:1}:c),config));
  assert.throws(()=>runBacktest(sample.filter((_,i)=>i!==3),config));
  assert.equal(evaluateAgents(sample.slice(0,2),config).action,'HOLD');
});
