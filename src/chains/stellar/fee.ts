/**
 * Fee estimation helpers for Stellar transactions.
 *
 * Wraith flows default to the minimum base fee (100 stroops), which can fail
 * during network congestion. These helpers pull recent fee data from Horizon
 * and return a suitable inclusion fee based on the desired urgency level.
 *
 * @example
 * ```ts
 * import { estimateFee } from "@wraith-protocol/sdk/chains/stellar";
 *
 * const fee = await estimateFee("payment", "normal");
 * // pass to buildStealthPayment({ fee, ... })
 * ```
 */

/** Operation kinds that influence base fee sizing. */
export type OpKind = 'payment' | 'create_account' | 'soroban';

/**
 * How quickly you need the transaction included.
 *
 * - `low`    — p10 of recent fee_charged; cheapest, may be slow under load
 * - `normal` — p50 (median); good default for most flows
 * - `high`   — p90; near-certain inclusion even during moderate congestion
 */
export type FeeUrgency = 'low' | 'normal' | 'high';

const HORIZON_TESTNET = 'https://horizon-testnet.stellar.org';
const MIN_FEE = 100;
const CACHE_TTL_MS = 10_000;

// Horizon /fee_stats shape (only the fields we use)
interface HorizonFeeStats {
  fee_charged: {
    p10: string;
    p50: string;
    p90: string;
  };
}

interface CacheEntry {
  stats: HorizonFeeStats;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

async function fetchFeeStats(horizonUrl: string): Promise<HorizonFeeStats> {
  const key = horizonUrl;
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.stats;

  const res = await fetch(`${horizonUrl}/fee_stats`);
  if (!res.ok) throw new Error(`Horizon fee_stats returned ${res.status}`);
  const stats = (await res.json()) as HorizonFeeStats;

  cache.set(key, { stats, expiresAt: Date.now() + CACHE_TTL_MS });
  return stats;
}

function pickPercentile(stats: HorizonFeeStats, urgency: FeeUrgency): number {
  const raw =
    urgency === 'low'
      ? stats.fee_charged.p10
      : urgency === 'high'
        ? stats.fee_charged.p90
        : stats.fee_charged.p50;

  return Math.max(MIN_FEE, parseInt(raw, 10) || MIN_FEE);
}

/**
 * Estimates an inclusion fee in stroops for the given operation kind and urgency.
 *
 * Soroban operations carry a higher base multiplier (×10) because they consume
 * more ledger resources than classic operations.
 *
 * @param opKind   - The type of operation being submitted.
 * @param urgency  - How aggressively to price for inclusion.
 * @param horizonUrl - Override the Horizon endpoint. Defaults to testnet.
 * @returns Fee in stroops as a string (compatible with `TransactionBuilder`).
 */
export async function estimateFee(
  opKind: OpKind,
  urgency: FeeUrgency = 'normal',
  horizonUrl = HORIZON_TESTNET,
): Promise<string> {
  const stats = await fetchFeeStats(horizonUrl);
  const base = pickPercentile(stats, urgency);

  // Soroban transactions consume significantly more ledger capacity
  const fee = opKind === 'soroban' ? base * 10 : base;
  return String(fee);
}

/** Clears the in-memory fee stats cache. Useful in tests. */
export function clearFeeCache(): void {
  cache.clear();
}
