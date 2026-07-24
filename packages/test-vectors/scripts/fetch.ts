#!/usr/bin/env node
/**
 * Fetches a bounded snapshot of real on-chain announcements from Stellar testnet
 * and writes them to fixtures/mainnet/stellar.json.
 *
 * Usage:
 *   pnpm --filter @wraith-protocol/test-vectors fetch
 *
 * Capped at 100 events so CI stays fast and the fixture file stays small.
 * Re-run manually when you want a fresher snapshot; commit the result.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseAnnouncementEvent } from '../../src/chains/stellar/announcements.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures', 'mainnet');
const MAX_EVENTS = 100;

const SOROBAN_URL = 'https://soroban-testnet.stellar.org';
const ANNOUNCER_V1 = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';

async function rpc(method: string, params: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(SOROBAN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (data.error) throw new Error(`RPC error: ${data.error.message}`);
  return data.result as Record<string, unknown>;
}

async function main() {
  console.log('Fetching Stellar announcements from testnet...');

  // Anchor to recent ledgers so we don't exceed the Soroban retention window
  const latest = await rpc('getLatestLedger', {});
  const latestSeq = (latest as { sequence: number }).sequence;
  const startLedger = Math.max(1, latestSeq - 5000);

  console.log(`  Ledger range: ${startLedger} – ${latestSeq}`);

  const result = await rpc('getEvents', {
    startLedger,
    filters: [{ type: 'contract', contractIds: [ANNOUNCER_V1] }],
    pagination: { limit: MAX_EVENTS },
  });

  const events = ((result as { events?: unknown[] }).events ?? []) as Record<string, unknown>[];
  console.log(`  Raw events fetched: ${events.length}`);

  const announcements = events
    .map((e) => parseAnnouncementEvent(e))
    .filter((a) => a !== null)
    .slice(0, MAX_EVENTS);

  console.log(`  Parsed announcements: ${announcements.length}`);

  const fixture = {
    _meta: {
      chain: 'stellar-testnet',
      sorobanUrl: SOROBAN_URL,
      announcer: ANNOUNCER_V1,
      ledgerRange: [startLedger, latestSeq],
      fetchedAt: new Date().toISOString(),
      count: announcements.length,
    },
    announcements,
  };

  mkdirSync(FIXTURES_DIR, { recursive: true });
  const outPath = join(FIXTURES_DIR, 'stellar.json');
  writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n');
  console.log(`  Written → ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
