import assert from "node:assert/strict";
import test from "node:test";
import { createPermissionDraft, validatePermissionDraft } from "../lib/delegation-policy.ts";
import { resolveAnalystEndpoint, validateModelReview, constrainModelAction, runModelReview } from "../lib/agent-provider.ts";

const input = { chainId: 8453 as const, dailyBudget: 100, perTradeBudget: 25, expiryDays: 7, tokens: ["USDC" as const, "WETH" as const] };
const snapshot = { symbol: "ETH", asOf: 1_700_000_000_000, evidence: [{ id: "price", label: "Close", value: 2500 }] };

test("permission draft is never an active grant and expires deterministically", () => {
  const draft = createPermissionDraft(input, 1_700_000_000_000);
  assert.equal(draft.status, "draft");
  assert.equal(draft.enforced, false);
  assert.equal(draft.signed, false);
  assert.equal(draft.liveExecutionEnabled, false);
  assert.equal(Date.parse(draft.expiresAt) - Date.parse(draft.createdAt), 7 * 86_400_000);
  assert.ok(draft.activationBlockers.some(x => x.includes("empty")));
});

test("permission inputs reject unbounded, invalid and over-budget scopes", () => {
  for (const change of [
    { dailyBudget: Infinity }, { dailyBudget: -1 }, { perTradeBudget: 101 },
    { expiryDays: 31 }, { expiryDays: 0 }, { chainId: 1 }, { tokens: ["USDT"] },
    { tokens: ["USDC", "USDC"] }, { allowedContracts: ["0x" + "0".repeat(40)] },
    { maxSlippageBps: 10000 }, { signed: true },
  ]) assert.throws(() => validatePermissionDraft({ ...input, ...change }));
});

test("endpoint selection refuses SSRF and unexpected paths", () => {
  assert.equal(resolveAnalystEndpoint().url, "https://api.openai.com/v1/responses");
  assert.equal(resolveAnalystEndpoint("https://api.deepseek.com/v1").url, "https://api.deepseek.com/chat/completions");
  for (const url of ["http://api.openai.com/v1", "https://api.openai.com.evil.com/v1", "https://localhost/v1", "https://api.openai.com/v1/files", "https://api.openai.com/v1?key=secret", "https://user:password@api.openai.com/v1"]) {
    assert.throws(() => resolveAnalystEndpoint(url));
  }
});

test("model evidence references must exist and numbers are rendered from snapshots", () => {
  assert.equal(validateModelReview({ action: "HOLD", summary: "Bukti belum cukup.", evidenceIds: ["price"] }, snapshot).action, "HOLD");
  assert.throws(() => validateModelReview({ action: "ENTER", summary: "Berita positif.", evidenceIds: ["unknown-news"] }, snapshot));
  assert.throws(() => validateModelReview({ action: "ENTER", summary: "Harga akan naik 90 persen.", evidenceIds: ["price"] }, snapshot));
  assert.throws(() => validateModelReview({ action: "BUY", summary: "Beli.", evidenceIds: ["price"] }, snapshot));
});

test("model cannot expand a baseline action or suppress an exit", () => {
  assert.equal(constrainModelAction("HOLD", "ENTER"), "HOLD");
  assert.equal(constrainModelAction("EXIT", "HOLD"), "EXIT");
  assert.equal(constrainModelAction("ENTER", "HOLD"), "HOLD");
  assert.equal(constrainModelAction("ENTER", "ENTER"), "ENTER");
});

test("unconfigured model is explicitly rules and does not call a provider", async () => {
  const result = await runModelReview(snapshot, { action: "ENTER", reason: "Baseline." }, {}, {});
  assert.equal(result.configured, false);
  assert.equal(result.engine, "rules");
  assert.equal(result.status, "not-configured");
  assert.equal(result.reviews.length, 0);
});

test("invalid provider setup fails closed without revealing configuration", async () => {
  const result = await runModelReview(snapshot, { action: "ENTER", reason: "Baseline." }, {}, { ANALYST_API_URL: "https://untrusted.invalid/v1", ANALYST_API_KEY: "sensitive-key-value", ANALYST_MODEL: "some-model" });
  assert.equal(result.status, "error");
  assert.equal(result.analysis.action, "HOLD");
  assert.equal(JSON.stringify(result).includes("sensitive-key-value"), false);
});

test("three model roles execute in order and stay inside the strategy envelope", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    assert.equal(init?.redirect, "manual");
    const body = JSON.parse(String(init?.body));
    calls.push(body.input[0].content);
    assert.equal(body.store, false);
    assert.equal(body.text.format.strict, true);
    return new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ action: "ENTER", summary: "Bukti yang tersedia saling mendukung.", evidenceIds: ["price"] }) }] }], usage: { input_tokens: 80, output_tokens: 30 } }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await runModelReview(snapshot, { action: "HOLD", reason: "No baseline entry." }, {}, { ANALYST_API_KEY: "test-only-key", ANALYST_MODEL: "test-model" });
    assert.equal(result.status, "completed");
    assert.equal(result.engine, "llm");
    assert.equal(result.analysis.action, "HOLD");
    assert.deepEqual(result.reviews.map(r => r.role), ["Research", "Challenger", "Synthesizer"]);
    assert.equal(calls.length, 3);
    assert.ok(calls[0].includes("Research"));
    assert.ok(calls[1].includes("Challenger"));
    assert.ok(calls[2].includes("Synthesizer"));
    assert.equal(result.inputTokens, 240);
    assert.equal(result.outputTokens, 90);
    assert.equal(JSON.stringify(result).includes("test-only-key"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a hallucinated evidence reference aborts review but preserves a protective exit", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ action: "HOLD", summary: "Ada bukti eksternal.", evidenceIds: ["fabricated"] }) }] }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await runModelReview(snapshot, { action: "EXIT", reason: "Risk exit." }, {}, { ANALYST_API_KEY: "test-only-key", ANALYST_MODEL: "test-model" });
    assert.equal(result.status, "error");
    assert.equal(result.analysis.action, "EXIT");
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("redirects and incomplete reasoning responses fail closed without leaking provider bodies", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const response of [new Response('sensitive provider response', {status:302,headers:{Location:'https://untrusted.invalid'}}), Response.json({status:'incomplete',output:[],usage:{input_tokens:20,output_tokens:30}})]) {
      let calls=0;
      globalThis.fetch=(async (_url:unknown,init?:RequestInit)=>{calls++;assert.equal(init?.redirect,'manual');return response;}) as typeof fetch;
      const result=await runModelReview(snapshot,{action:'ENTER',reason:'Baseline.'},{},{ANALYST_API_KEY:'test-only-key',ANALYST_MODEL:'test-model'});
      assert.equal(result.status,'error');
      assert.equal(result.analysis.action,'HOLD');
      assert.equal(calls,1);
      assert.equal(JSON.stringify(result).includes('sensitive provider response'),false);
    }
  } finally { globalThis.fetch=originalFetch; }
});
