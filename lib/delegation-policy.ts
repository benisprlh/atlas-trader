/** This is a permission DRAFT builder, not an ERC-7715 grant or an onchain enforcer.
 * Integration reference: https://docs.metamask.io/smart-accounts-kit/
 * A token allowance alone does not constrain swap recipients, routes or slippage.
 * The approved implementation must enforce those boundaries separately before live use.
 */
import { z } from "zod";

export const BASE_CHAIN_ID = 8453;
export const BASE_TOKENS = {
  WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
  USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
} as const;
export type AllowedToken = keyof typeof BASE_TOKENS;

const Budget = z.number().finite().positive().max(1_000_000);
const PermissionInputSchema = z.object({
  chainId: z.literal(BASE_CHAIN_ID),
  dailyBudget: Budget,
  perTradeBudget: Budget,
  expiryDays: z.number().int().min(1).max(30),
  tokens: z.array(z.enum(["WETH", "USDC"])).min(1).max(2),
  allowedContracts: z.array(z.string().regex(/^0x[a-fA-F0-9]{40}$/)).max(8).default([]),
  maxSlippageBps: z.number().int().min(1).max(300).default(50),
}).strict().superRefine((value, ctx) => {
  if (value.perTradeBudget > value.dailyBudget) ctx.addIssue({ code: "custom", path: ["perTradeBudget"], message: "Per-trade budget must not exceed daily budget." });
  if (new Set(value.tokens).size !== value.tokens.length) ctx.addIssue({ code: "custom", path: ["tokens"], message: "Duplicate token permissions are not allowed." });
  if (new Set(value.allowedContracts.map(a => a.toLowerCase())).size !== value.allowedContracts.length) ctx.addIssue({ code: "custom", path: ["allowedContracts"], message: "Duplicate contracts are not allowed." });
  if (value.allowedContracts.some(a => /^0x0{40}$/i.test(a))) ctx.addIssue({ code: "custom", path: ["allowedContracts"], message: "Zero-address contracts are not allowed." });
});

export type PermissionDraftInput = z.input<typeof PermissionInputSchema>;
export type ValidatedPermissionDraftInput = z.output<typeof PermissionInputSchema>;
export function validatePermissionDraft(input: unknown): ValidatedPermissionDraftInput {
  return PermissionInputSchema.parse(input);
}

export function createPermissionDraft(input: unknown, now = Date.now()) {
  if (!Number.isFinite(now) || now < 0) throw new Error("Invalid draft creation timestamp.");
  const validated = validatePermissionDraft(input);
  return {
    schemaVersion: 1 as const,
    status: "draft" as const,
    enforced: false as const,
    signed: false as const,
    liveExecutionEnabled: false as const,
    chainId: validated.chainId,
    budgets: { dailyUsd: validated.dailyBudget, perTradeUsd: validated.perTradeBudget },
    tokens: validated.tokens.map(symbol => ({ symbol, ...BASE_TOKENS[symbol] })),
    allowedContracts: validated.allowedContracts,
    maxSlippageBps: validated.maxSlippageBps,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + validated.expiryDays * 86_400_000).toISOString(),
    activationBlockers: [
      "Wallet-specific smart-account support and network compatibility must be verified.",
      "A reviewed swap executor and exact function/recipient/token constraints must be selected.",
      ...(validated.allowedContracts.length ? [] : ["Contract allowlist is empty; no transaction is authorized."]),
      "USD budgets are application estimates, not token-denominated onchain spending limits.",
      "The user must independently review and grant a bounded wallet permission.",
      "Revocation, expiry, slippage, gas limits and malicious-route tests must pass before live activation.",
    ],
  };
}
