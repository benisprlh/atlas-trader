import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Execute the real service and real engine with an isolated D1/network boundary.
// The production Cloudflare binding is unavailable in Node's test process.
const bindings: Record<string, unknown> = {};
(globalThis as any).__atlasTestBindings = bindings;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export const env=globalThis.__atlasTestBindings', shortCircuit: true };
  if (context.parentURL?.includes('/lib/') && specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(new URL(specifier + '.ts', context.parentURL).href, context);
  return nextResolve(specifier, context);
} });
// @ts-ignore Node's native TypeScript loader requires the .ts extension.
const { paperAction } = await import('../lib/paper-service.ts');

function memoryDatabase() {
  let row: { payload: string; revision: number } | null = null;
  return {
    prepare(sql: string) { return { bind(...values: any[]) { return {
      async first() { return row ? { ...row } : null; },
      async run() {
        if (sql.startsWith('INSERT') && !row) { row = { payload: values[1], revision: 0 }; return { meta: { changes: 1 } }; }
        if (sql.startsWith('UPDATE') && row && row.revision === values[3]) { row = { payload: values[0], revision: row.revision + 1 }; return { meta: { changes: 1 } }; }
        return { meta: { changes: 0 } };
      },
    }; } }; },
    read() { return row ? JSON.parse(row.payload) : null; },
  };
}

test('paper service preserves prospective execution, idempotency and live-only data', async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const hour = 3_600_000;
  let clock = Date.UTC(2026, 10, 6, 10, 7);
  const origin = Math.floor(clock / hour) * hour - 80 * hour;
  let marketFail = false;
  let modelInvalid = false;
  let modelCalls = 0;
  const database = memoryDatabase();
  bindings.DB = database;
  Date.now = () => clock;
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    if (url.includes('api.kraken.com')) {
      if (marketFail) return new Response('unavailable', { status: 503 });
      const last = Math.floor(clock / hour) * hour - hour;
      const rows = Array.from({ length: 72 }, (_, i) => {
        const time = last - (71 - i) * hour;
        const price = 2000 + (time - origin) / hour * 10;
        return [time / 1000, price, price * 1.002, price * 0.999, price, price, 100, 50];
      });
      return Response.json({ error: [], result: { XETHZUSD: rows, last: last / 1000 } });
    }
    if (url.includes('api.openai.com')) {
      modelCalls++;
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ action: 'ENTER', summary: modelInvalid ? 'Peluang profit 99 persen.' : 'Bukti tren mendukung kandidat dengan risiko tetap dibatasi.', evidenceIds: ['fast_sma'] }) }] }], usage: { input_tokens: 50, output_tokens: 20 } });
    }
    throw new Error('Unexpected test network destination');
  }) as typeof fetch;
  try {
    await assert.rejects(() => paperAction({ action: 'start', source: 'sample' }), /live data/);
    assert.equal(database.read(), null);

    bindings.ANALYST_API_KEY = 'test-not-a-real-key';
    bindings.ANALYST_MODEL = 'test-model';
    const started = await paperAction({ action: 'start', source: 'live', symbol: 'ETH', config: { fastPeriod: 2, slowPeriod: 3 } });
    assert.equal(started.session.paperState.trades.length, 0);
    assert.equal(started.session.mode, 'paper');
    assert.equal(started.session.source.kind, 'live');
    assert.match(started.session.source.executionModel, /not a DEX/);
    assert.equal(modelCalls, 3);
    const completedAt = started.session.paperState.pendingCompletedAt;
    const again = await paperAction({ action: 'start' });
    assert.equal(again.session.id, started.session.id);
    assert.equal(modelCalls, 3);

    clock += hour;
    const deferred = await paperAction({ action: 'tick' });
    assert.equal(deferred.session.paperState.trades.length, 0);
    assert.equal(deferred.session.paperState.pendingCompletedAt, completedAt);
    assert.equal(modelCalls, 3, 'A deferred already-reviewed proposal must not be retimed by another review.');

    clock += hour;
    const filled = await paperAction({ action: 'tick' });
    assert.equal(filled.session.paperState.trades.filter((t: any) => t.side === 'BUY').length, 1);
    assert.ok(filled.session.paperState.trades[0].time >= completedAt);
    assert.equal(filled.session.historyRetention.retained, 'latest');
    const duplicate = await paperAction({ action: 'tick' });
    assert.deepEqual(duplicate.session.paperState.trades, filled.session.paperState.trades);

    marketFail = true;
    clock += hour;
    const failure = await paperAction({ action: 'tick' });
    assert.ok(failure.error);
    assert.deepEqual(failure.session.paperState, filled.session.paperState, 'Failed cycles cannot commit a partially changed ledger.');
    marketFail = false;

    await paperAction({ action: 'pause' });
    await assert.rejects(() => paperAction({ action: 'start' }), /Reset/);
    const reset = await paperAction({ action: 'reset' });
    assert.equal(reset.session, null);

    delete bindings.ANALYST_API_KEY;
    delete bindings.ANALYST_MODEL;
    const rulesStarted = await paperAction({ action: 'start', source: 'live', symbol: 'ETH' });
    assert.equal(rulesStarted.session.modelReview.status, 'not-configured');
    const beforeActivationCalls = modelCalls;
    bindings.ANALYST_API_KEY = 'test-not-a-real-key';
    bindings.ANALYST_MODEL = 'test-model';
    const activated = await paperAction({ action: 'tick' });
    assert.equal(activated.session.id, rulesStarted.session.id);
    assert.equal(activated.session.modelReview.status, 'completed');
    assert.equal(modelCalls, beforeActivationCalls + 3);
    assert.equal(activated.session.paperState.trades.length, 0);
    await paperAction({ action: 'tick' });
    assert.equal(modelCalls, beforeActivationCalls + 3, 'Activation must not repeat on the same candle.');
    await paperAction({ action: 'pause' });
    await paperAction({ action: 'reset' });

    modelInvalid = true;
    const failedReview = await paperAction({ action: 'start', source: 'live', symbol: 'ETH', config: { fastPeriod: 2, slowPeriod: 3 } });
    assert.equal(failedReview.session.modelReview.status, 'error');
    assert.equal(failedReview.session.paperState.pendingAction, 'HOLD');
    assert.equal(failedReview.session.paperState.trades.length, 0);
  } finally {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
    delete bindings.ANALYST_API_KEY;
    delete bindings.ANALYST_MODEL;
  }
});
