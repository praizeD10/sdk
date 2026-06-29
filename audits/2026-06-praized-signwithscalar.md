# Security Audit: `signWithScalar`

**Auditor:** praized  
**Date:** 2026-06-29  
**Scope:** `src/chains/stellar/scalar.ts` — `signWithScalar` only  
**Version:** 1.4.5

---

## Summary

`signWithScalar` is a custom ed25519 signing routine that operates on a derived
scalar instead of the standard 32-byte seed. This is **necessary** — stealth
private scalars cannot be decomposed back into a seed.

**Findings: 0 Critical, 0 High, 1 Medium (addressed), 1 Low (addressed), 2 Informational.**

---

## Why `signWithScalar` is necessary

RFC 8032 §5.1.5 specifies that an ed25519 private key is a 32-byte random seed.
Signing always starts from that seed:

```
h = SHA-512(seed)
a = clamp(h[0:32])          ← private scalar
prefix = h[32:64]            ← nonce material
A = [a]B                    ← public key
r = SHA-512(prefix || M) mod L
R = [r]B
k = SHA-512(R || A || M) mod L
S = (r + k*a) mod L
signature = R || S
```

Stellar stealth private scalars are derived as:

```
stealthScalar = (spendingScalar + hashScalar) % L
```

This is a bigint in (0, L). There is no seed. Calling `Keypair.fromRawEd25519Seed()`
would require a seed that, when processed by SHA-512 and clamped, produces
`stealthScalar` — that inverse is not computable. Therefore a custom signing
path is required.

---

## RFC 8032 reconstruction vs implementation

| Step | RFC 8032 §5.1.6 | `signWithScalar` | Match |
|------|-----------------|------------------|-------|
| 1. Private scalar | `clamp(SHA-512(seed)[0:32])` | passed directly as `scalar` | N/A — no seed |
| 2. Nonce material | `prefix = SHA-512(seed)[32:64]` | `prefix = SHA-256(scalarBytes)` | **Deviation** — justified |
| 3. Nonce | `r = SHA-512(prefix \|\| M) % L` | `r = SHA-512(prefix \|\| M) % L` | ✓ |
| 4. Commit | `R = [r]B` | `R = [r]B` | ✓ |
| 5. Challenge | `k = SHA-512(R \|\| A \|\| M) % L` | `k = SHA-512(R \|\| A \|\| M) % L` | ✓ |
| 6. Response | `S = (r + k*s) % L` | `S = (r + k*scalar) % L` | ✓ |
| 7. Output | `R \|\| S` (64 bytes, LE) | `R \|\| S` (64 bytes, LE) | ✓ |

The only deviation is step 2. Every other step is identical to RFC 8032.

---

## Finding 1: Nonce derivation deviates from RFC 8032

**Severity:** Medium (informational given necessity)  
**Status:** Addressed — documented and tested

### Detail

RFC 8032 derives nonce material as the upper 32 bytes of `SHA-512(seed)`. Since
no seed exists here, the implementation uses `SHA-256(scalarBytes)` instead.

### Security analysis

The prefix serves one purpose: produce a per-message, secret-dependent value
so that `r = SHA-512(prefix || message) % L` is unique per `(scalar, message)`
pair and unpredictable to anyone who does not know `scalar`.

`SHA-256(scalarBytes)` satisfies both requirements:
- **Deterministic:** same scalar always produces same prefix → same `r`
- **Secret-dependent:** `r` is unpredictable without knowing `scalar`
- **Bias:** `r` is reduced from a 512-bit SHA-512 output. Since `2^512 / L ≈ 2^260`,
  bias is at most `1 / 2^252` — negligible

The construction is equivalent in security to the RFC 8032 nonce path. A 32-byte
SHA-256 output contains enough entropy to make the 64-byte SHA-512 input
irreducible without the scalar.

### Cross-validation

`@noble/curves ed25519.verify()` accepts all signatures produced by this function.
The verification equation `[8][S]B = [8]R + [8][k]A` (RFC 8032 §5.1.7) holds
because steps 3–7 are identical to the standard.

---

## Finding 2: Missing input validation on scalar range

**Severity:** Low  
**Status:** Fixed — guard present in current code

### Detail

If `scalar = 0`, then `S = (r + k*0) % L = r`. An attacker who observes `R`
and can influence the message could recover the nonce `r` (since `R = [r]B`
and `S = r`). This breaks the scheme entirely for that signing key.

If `scalar >= L`, the scalar arithmetic silently wraps, producing a signature
for a different effective scalar.

### Fix

```typescript
if (scalar <= 0n || scalar >= L) {
  throw new Error('Scalar must be in range (0, L)');
}
```

This is present at line 117–119 of `scalar.ts`.

---

## Finding 3: `bytesToScalar` interprets all 64 bytes of SHA-512 as LE integer

**Severity:** Informational  
**Status:** Correct by construction

`bytesToScalar` converts a byte array to a bigint using little-endian order,
consistent with RFC 8032 §5.1.2: "integers are coded using little-endian
convention." When applied to a 64-byte SHA-512 output for nonce derivation,
this produces a 512-bit integer before reduction mod L — matching RFC 8032 step 2.

---

## Finding 4: No cofactor multiplication in signing

**Severity:** Informational  
**Status:** Consistent with RFC 8032 Ed25519 (cofactor = 8)

RFC 8032 §5.1.7 verification uses `[8][S]B = [8]R + [8][k]A`. The cofactor
multiplication applies only to verification, not signing. The `@noble/curves`
verifier handles this correctly, so `signWithScalar` does not need to apply it.

---

## Test vectors

See `test/chains/stellar/signwithscalar-vectors.test.ts`.

| Test | Result |
|------|--------|
| Signatures verify with `ed25519.verify` | Pass |
| RFC 8032 §3.3 equation `S = (r + k*a) mod L` holds | Pass |
| Determinism | Pass |
| Different messages → different nonces | Pass |
| Different scalars → different signatures | Pass |
| scalar = 0 rejected | Pass |
| scalar = -1 rejected | Pass |
| scalar = L rejected | Pass |
| scalar = L+1 rejected | Pass |
| scalar = 1 (minimum valid) | Pass |
| scalar = L-1 (maximum valid) | Pass |
| Empty message | Pass |
| 1 MB message | Pass |
| Known-answer vectors (3) | Pass |
| `scalarToBytes` / `bytesToScalar` round-trip | Pass |
| Little-endian encoding verified | Pass |

---

## Conclusion

`signWithScalar` is a sound implementation. The nonce derivation deviation from
RFC 8032 is justified and carries no exploitable weakness. The zero-scalar and
out-of-range guards prevent the only practical misuse vectors. All signatures
cross-validate against `@noble/curves`.

No findings require coordination with security@usewraith.xyz.
