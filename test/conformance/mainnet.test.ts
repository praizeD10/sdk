/**
 * Mainnet fixture conformance suite.
 *
 * Runs against committed JSON snapshots under packages/test-vectors/fixtures/mainnet/.
 * These are deterministic on-chain-shaped snapshots that serve as regression
 * anchors — if parsing, address encoding, or struct shapes change, these break first.
 *
 * No network calls. No private keys. Fully deterministic.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SCHEME_ID, SCHEME_ID_V2 } from '../../src/chains/stellar/constants';
import { pubKeyToStellarAddress } from '../../src/chains/stellar/scalar';
import { hexToBytes } from '../../src/chains/stellar/utils';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Stellar G-address: G + 55 chars from base32 alphabet [A-Z2-7]
const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

function loadFixture(name: string) {
  const p = join(__dirname, '../../packages/test-vectors/fixtures/mainnet', name);
  return JSON.parse(readFileSync(p, 'utf-8'));
}

// ---------------------------------------------------------------------------
// Stellar fixture conformance
// ---------------------------------------------------------------------------

describe('Stellar mainnet fixtures', () => {
  const fixture = loadFixture('stellar.json');
  const raw: Array<Record<string, unknown>> = fixture.announcements;

  test('fixture loads and has expected shape', () => {
    expect(fixture._meta.chain).toBe('stellar-testnet');
    expect(Array.isArray(raw)).toBe(true);
    expect(raw.length).toBeGreaterThan(0);
    expect(raw.length).toBeLessThanOrEqual(100);
  });

  test('all records have required fields', () => {
    for (const ann of raw) {
      expect(typeof ann.schemeId).toBe('number');
      expect(typeof ann.stealthPubKeyHex).toBe('string');
      expect(typeof ann.caller).toBe('string');
      expect(typeof ann.ephemeralPubKey).toBe('string');
      expect(typeof ann.metadata).toBe('string');
    }
  });

  test('all schemeIds are known (v1 or v2)', () => {
    for (const ann of raw) {
      expect([SCHEME_ID, SCHEME_ID_V2]).toContain(ann.schemeId);
    }
  });

  test('stealthPubKeyHex fields are valid 64-char lowercase hex', () => {
    for (const ann of raw) {
      expect(ann.stealthPubKeyHex as string).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test('pubKeyToStellarAddress produces valid G-addresses for all stealthPubKeyHex values', () => {
    for (const ann of raw) {
      const pubKeyBytes = hexToBytes(ann.stealthPubKeyHex as string);
      const address = pubKeyToStellarAddress(pubKeyBytes);
      expect(address).toMatch(STELLAR_ADDRESS_RE);
    }
  });

  test('all ephemeralPubKeys are 64-char lowercase hex (32 bytes)', () => {
    for (const ann of raw) {
      expect(ann.ephemeralPubKey as string).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test('all metadata strings are non-empty lowercase hex', () => {
    for (const ann of raw) {
      expect(ann.metadata as string).toMatch(/^[0-9a-f]+$/);
      expect((ann.metadata as string).length).toBeGreaterThanOrEqual(2);
    }
  });

  test('v1 records have no viewTagBucket', () => {
    for (const ann of raw.filter((a) => a.schemeId === SCHEME_ID)) {
      expect(ann.viewTagBucket == null).toBe(true);
    }
  });

  test('v2 records have a numeric viewTagBucket in [0, 255]', () => {
    for (const ann of raw.filter((a) => a.schemeId === SCHEME_ID_V2)) {
      expect(typeof ann.viewTagBucket).toBe('number');
      expect(ann.viewTagBucket as number).toBeGreaterThanOrEqual(0);
      expect(ann.viewTagBucket as number).toBeLessThanOrEqual(255);
    }
  });

  test('ledger numbers are positive integers when present', () => {
    for (const ann of raw) {
      if (ann.ledger != null) {
        expect(Number.isInteger(ann.ledger)).toBe(true);
        expect(ann.ledger as number).toBeGreaterThan(0);
      }
    }
  });

  test('view tags extracted from metadata are in [0, 255]', () => {
    for (const ann of raw) {
      const viewTag = parseInt((ann.metadata as string).slice(0, 2), 16);
      expect(viewTag).toBeGreaterThanOrEqual(0);
      expect(viewTag).toBeLessThanOrEqual(255);
    }
  });

  test('pubKeyToStellarAddress output is stable for known inputs (regression)', () => {
    // Pin the address derived from a fixed byte seed.
    // If pubKeyToStellarAddress changes its encoding, this breaks.
    const seed = hexToBytes('0101010101010101010101010101010101010101010101010101010101010101');
    const address = pubKeyToStellarAddress(seed);
    expect(address).toMatchSnapshot();
  });

  test('fixture fingerprint is stable (regression)', () => {
    // Catches accidental fixture edits in CI.
    const fingerprint = raw
      .map((a) => `${a.schemeId}:${(a.ephemeralPubKey as string).slice(0, 8)}:${a.ledger ?? 0}`)
      .join('|');
    expect(fingerprint).toMatchSnapshot();
  });
});
