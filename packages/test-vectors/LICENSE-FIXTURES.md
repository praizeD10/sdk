# Fixture Data License & Attribution

The JSON files under `fixtures/` are snapshots of public on-chain event data
fetched from the Stellar and EVM networks via their public RPC/API endpoints.

## Stellar

- **Source:** Soroban RPC (`soroban-testnet.stellar.org`) — public, no auth required
- **Data:** Soroban contract events emitted by the Wraith announcer contracts
- **Content:** Each record contains only fields that are already public on-chain:
  `schemeId`, `stealthAddress`, `ephemeralPubKey`, `metadata`, `ledger`, `viewTagBucket`
- **No private data:** No private keys, secrets, or user-identifying information
- **License:** On-chain data is public domain. The fixture format is MIT (same as this repo).

## Regenerating

Run `pnpm --filter @wraith-protocol/test-vectors fetch` to re-fetch a fresh
bounded snapshot (100 events max). The resulting JSON is deterministic for the
same ledger range and should be committed to version control for stable CI.
