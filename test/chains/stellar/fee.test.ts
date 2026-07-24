import { afterEach, describe, expect, test, vi } from 'vitest';
import { estimateFee, clearFeeCache } from '../../../src/chains/stellar/fee';

// Minimal Horizon /fee_stats mock
function mockFeeStats(p10: string, p50: string, p90: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ fee_charged: { p10, p50, p90 } }),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearFeeCache();
});

describe('estimateFee', () => {
  test('returns p50 for normal urgency (payment)', async () => {
    mockFeeStats('150', '300', '600');
    expect(await estimateFee('payment', 'normal')).toBe('300');
  });

  test('returns p10 for low urgency', async () => {
    mockFeeStats('150', '300', '600');
    expect(await estimateFee('payment', 'low')).toBe('150');
  });

  test('returns p90 for high urgency', async () => {
    mockFeeStats('150', '300', '600');
    expect(await estimateFee('payment', 'high')).toBe('600');
  });

  test('applies 10x multiplier for soroban ops', async () => {
    mockFeeStats('150', '300', '600');
    expect(await estimateFee('soroban', 'normal')).toBe('3000');
  });

  test('floors at MIN_FEE (100) when stats return zero', async () => {
    mockFeeStats('0', '0', '0');
    expect(await estimateFee('payment', 'normal')).toBe('100');
  });

  test('floors at MIN_FEE when stats return value below minimum', async () => {
    mockFeeStats('10', '50', '80');
    expect(await estimateFee('payment', 'low')).toBe('100');
  });

  test('caches the response — only one fetch for two calls', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ fee_charged: { p10: '100', p50: '200', p90: '400' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await estimateFee('payment', 'normal');
    await estimateFee('create_account', 'high');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('re-fetches after cache TTL expires', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ fee_charged: { p10: '100', p50: '200', p90: '400' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    // Populate cache
    await estimateFee('payment', 'normal');

    // Manually expire by clearing
    clearFeeCache();
    await estimateFee('payment', 'normal');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('throws when Horizon returns a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503 })),
    );
    await expect(estimateFee('payment', 'normal')).rejects.toThrow('503');
  });

  test('create_account uses same fee as payment (no multiplier)', async () => {
    mockFeeStats('150', '300', '600');
    const payment = await estimateFee('payment', 'normal');
    clearFeeCache();
    mockFeeStats('150', '300', '600');
    const createAccount = await estimateFee('create_account', 'normal');
    expect(payment).toBe(createAccount);
  });

  test('defaults to normal urgency when omitted', async () => {
    mockFeeStats('150', '300', '600');
    expect(await estimateFee('payment')).toBe('300');
  });
});
