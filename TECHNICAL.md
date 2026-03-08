# PQ Drug Safety Oracle — Technical Documentation

> For installation and setup, see [README.md](./README.md).

---

## Architecture

```
OpenFDA API
    ↓
publisher.py (CLI)
    ├── Fetch recall data
    ├── Upload JSON to Pinata IPFS → CID
    ├── Compute data_hash = Poseidon(CID bytes)
    ├── Sign with Falcon-512 (Poseidon hash_to_point)
    └── Publish to StarkNet contract

StarkNet Contract (DrugSafetyOracle)
    ├── Verify message binding (Poseidon recomputed on-chain)
    ├── Verify Falcon-512 signature (norm check)
    └── Store: recall_id → { data_hash, cid, status, severity }

Frontend (Next.js)
    ├── Query contract via starknet.js (no backend)
    ├── Fetch full JSON from IPFS via CID
    └── Verify data integrity on-chain
```

---

## Chain of Trust

```
Recall JSON
    → upload to IPFS
    → CID (content-addressed, immutable)
    → Poseidon(CID bytes) = data_hash
    → Poseidon(recall_id, data_hash) = msg_hash
    → hash_to_point_poseidon(msg_hash) = msg_point  [512 coefficients in Z_q]
    → Falcon-512 sample_preimage(sk, msg_point) = (s1, s2)
    → on-chain: verify_uncompressed(s2, pk, msg_point) ← PQS enforcement
```

Every layer is cryptographically bound to the layer below. An attacker cannot forge a recall without the Falcon-512 private key, even with a quantum computer.

---

## Cryptographic Design

### Why Falcon-512

Falcon (Fast Fourier Lattice-based Compact Signatures over NTRU) is one of three digital signature algorithms selected by NIST for post-quantum standardization (FIPS 206). Security is based on the hardness of the NTRU lattice problem — no known efficient algorithm exists, classical or quantum.

| Parameter | Value |
|-----------|-------|
| N (degree) | 512 |
| Q (modulus) | 12289 |
| sig_bound | 34,034,726 |
| Public key | 512 × u16 coefficients |
| Signature | 1024 felt252 (s2 + msg_point) |
| PK upload TXs | 1 (all 512 coefficients in single TX) |

### hash_to_point: SHAKE-256 → Poseidon

Standard Falcon uses SHAKE-256 to map a message to a polynomial point. SHAKE-256 is not available in Cairo without SNIP-32 syscall (still a proposal). We replace it with **Poseidon sponge** — Cairo's native ZK-friendly builtin.

**Poseidon sponge construction:**
```
state[0]   = msg_hash
state[k+1] = Poseidon(state[k], k)
coef[k]    = state[k+1] % Q
```

This is computed identically in both Python (signer) and Cairo (contract), enabling on-chain message binding verification.

**Security properties preserved:**
- Collision resistance ✅ (Poseidon is a cryptographic hash)
- Uniform distribution over Z_q ✅ (mod Q reduction)
- Avalanche effect ✅ (each coefficient depends on all previous via chain)
- Falcon NTRU security ✅ (independent of hash function choice)

### Message Binding

**Vulnerability fixed:** Standard Falcon implementations pass `msg_point` as part of the signature calldata. Without binding verification, an attacker could replay a valid `(s2, msg_point)` pair from another context with forged recall data.

**Fix:** The contract recomputes `expected_msg_point` on-chain from `(recall_id, data_hash)` and asserts equality before running Falcon verification:

```cairo
// Step 1: recompute msg_hash from submitted data
let msg_hash = Poseidon(recall_id, data_hash);

// Step 2: recompute expected msg_point on-chain
let expected_point = _hash_to_point_poseidon(msg_hash);

// Step 3: binding check — REVERT if tampered
assert expected_point[i] == provided_msg_point[i] for all i in 0..512

// Step 4: Falcon norm check — REVERT if s2 invalid
verify_uncompressed(s2, pk, msg_point)

// Step 5: store — only reached if both checks pass
self.recalls.write(recall_id, entry)
```

**Attack vectors blocked:**

| Attack | Where it fails |
|--------|---------------|
| Fake msg_point | Step 3 — binding check |
| Fake s2 | Step 4 — Falcon norm check |
| Replay (s2, msg_point) from different recall_id | Step 3 — msg_hash differs |
| Forge without private key | Step 4 — SIS problem, quantum-resistant |

### Signature Verification (on-chain)

`verify_uncompressed` from `s2morrow/falcon`:

```
s0 = msg_point - s2 * pk  (polynomial multiplication mod Q, via NTT)
norm²(s0, s2) ≤ sig_bound (34,034,726 for N=512)
```

Where:
- `s0, s2` are centered in `(-Q/2, Q/2]` before norm computation
- NTT (Number Theoretic Transform) used for efficient polynomial multiplication
- `sig_bound` is the Euclidean norm bound from Falcon spec

---

## Contract

### Storage

```cairo
public_key:   Vec<u16>          // 512 Falcon-512 pk coefficients
pk_hash:      felt252           // Poseidon(pk) — verified at upload completion
pk_loaded:    u32               // tracks upload progress (0..512)
recalls:      Map<felt252, RecallEntry>
recall_cid:   Map<felt252, ByteArray>
recall_count: u32
recall_index: Map<u32, felt252> // for pagination
```

### RecallEntry

```cairo
struct RecallEntry {
    drug_name_hash: felt252,  // Poseidon(drug_name bytes)
    data_hash:      felt252,  // Poseidon(CID bytes)
    status:         u8,       // 0=Active, 1=Terminated, 2=Completed
    severity:       u8,       // 0=Class I, 1=Class II, 2=Class III
    published_at:   u64,      // Unix timestamp
    is_valid:       bool,     // existence check
}
```

### Public Key Upload

All 512 public key coefficients are uploaded in a single transaction. After upload, the contract computes `Poseidon(pk)` and asserts it matches `pk_hash` set at deployment — preventing partial or tampered key uploads.

### Interface

```cairo
// Write
fn publish_recall(recall_id, drug_name_hash, data_hash, status, severity, timestamp, cid, signature)
fn upload_pk_chunk(chunk: Array<u16>, offset: u32)

// Read
fn get_recall(recall_id) -> RecallEntry
fn get_recall_cid(recall_id) -> ByteArray
fn get_recall_count() -> u32
fn get_recall_id_by_index(idx) -> felt252
fn is_recall_active(recall_id) -> bool
fn verify_data_integrity(recall_id, data_hash) -> bool
fn is_pk_ready() -> bool
fn get_public_key() -> Array<u16>
```

---

## Signer

### Keypair (oracle_key.json)

```json
{
  "n":      512,
  "f":      [...],     // 512 coefficients — NTRU private key component
  "g":      [...],     // 512 coefficients — NTRU private key component
  "F":      [...],     // 512 coefficients — NTRU private key component
  "G":      [...],     // 512 coefficients — NTRU private key component
  "pk":     [...],     // 512 coefficients — public key (uploaded to contract)
  "pk_hash":"0x...",   // Poseidon(pk) — used as constructor argument
  "vk_hex": "..."      // serialized verification key
}
```

`oracle_key.json` must never be committed to git. It is the only thing that authorizes publishing to the contract.

### Signing Flow

```python
# 1. Compute msg_hash
msg_hash  = poseidon_hash_many([recall_id, data_hash])
message   = msg_hash.to_bytes(32, 'big')

# 2. Compute msg_point via Poseidon sponge (mirrors Cairo)
msg_point = hash_to_point_poseidon(msg_hash)

# 3. Sample preimage (bypass falcon.sign(), use low-level API)
(f, g, F, G, B0_fft, T_fft) = sk
s = falcon.__sample_preimage__(B0_fft, T_fft, msg_point)
# s[1] = s2, where: s[0] + s[1]*h = msg_point (mathematically bound)

# 4. Local norm verification (mirrors Cairo verify_uncompressed)
norm²(s0, s2) ≤ 34,034,726

# 5. Encode for StarkNet calldata
signature = s2 + msg_point  # 1024 felt252
```

### Why `__sample_preimage__` instead of `falcon.sign()`

`falcon.sign()` internally calls `__hash_to_point__(message, salt)` using SHAKE-256, producing a `msg_point` that Cairo cannot reproduce. By calling `__sample_preimage__` directly with our Poseidon-derived `msg_point`, we get `s2` that is mathematically bound to our `msg_point` — enabling on-chain binding verification.

---

## Publisher

### Flow

```
1. Fetch recalls from OpenFDA (sorted by recall_initiation_date:desc)
2. Check on-chain via get_recall() — skip if already published
3. Upload JSON to Pinata IPFS → CID
4. data_hash = Poseidon(CID bytes)
5. recall_id = SHA-256(recall_number) mod field_prime
6. drug_name_hash = SHA-256(drug_name) mod field_prime
7. Sign: msg_hash = Poseidon(recall_id, data_hash) → Falcon-512
8. Publish TX to StarkNet
9. Update Pinata metadata with tx_hash
10. Save local cache (reference only)
```

### Duplicate Prevention

On-chain check (not cache-based):
```python
async def is_published_onchain(contract, recall_id_felt):
    entry = await contract.functions["get_recall"].call(recall_id_felt)
    return entry.is_valid
```

---

## Frontend

### Data Flow

```
1. starknet.js → get_recall_count()
2. starknet.js → get_recall_id_by_index(i) for i in range
3. starknet.js → get_recall(recall_id) + get_recall_cid(recall_id) [parallel]
4. fetch(IPFS_GATEWAY/CID) → full JSON
5. Render: on-chain fields + IPFS fields combined
```

### Verify Data Integrity

```
1. get_recall_cid(recall_id) → CID from contract
2. fetch(CID) → JSON from IPFS
3. contract.verify_data_integrity(recall_id, data_hash) → bool
   (contract checks: entry.data_hash == provided data_hash)
```

### ByteArray Decoding

starknet.js returns `ByteArray` as an object `{data: [...], pending_word, pending_word_len}`. Custom decoder:

```typescript
function decodeByteArray(raw: any): string {
  // Decode full 31-byte words
  // Decode pending bytes (pending_word_len bytes from pending_word)
}
```

### Environment Variables

All variables require `NEXT_PUBLIC_` prefix to be accessible in the browser:

```
NEXT_PUBLIC_RPC_URL
NEXT_PUBLIC_ORACLE_ADDRESS
NEXT_PUBLIC_IPFS_GATEWAY
```

---

## Security Model

### What is Protected

```
Data authenticity:
  Falcon-512 signed on-chain — quantum-resistant ✅
  Anyone can verify: call verify_data_integrity() or verify_uncompressed()

Data availability:
  Stored on IPFS (Pinata) — content-addressed, immutable CID
  CID committed on-chain — tampering detectable ✅
  Availability depends on pinning service (not quantum-resistant claim)

Access control:
  Only holder of oracle_key.json can publish
  Contract enforces via Falcon-512 public key verification
  No admin key, no multisig — pure cryptographic enforcement ✅
```

### What is Not Protected

```
TX delivery:
  Mozi account uses ECDSA (StarkNet default)
  Attacker can DoS (prevent TX from being sent) but cannot forge data
  ECDSA is acceptable here: attacker cannot publish fake data without private key

IPFS availability:
  If Pinata unpins the file, CID becomes unreachable
  On-chain record remains valid — data_hash still verifiable
  Mitigation: pin to multiple providers in production
```

### Threat Model

| Threat | Mitigation |
|--------|-----------|
| Forge recall data | Falcon-512 signature required — quantum-resistant |
| Replay valid signature | Message binding: msg_point bound to (recall_id, data_hash) |
| Tamper IPFS data | CID is content-addressed — different data = different CID |
| Quantum attack on signatures | Falcon-512 (NTRU lattice) — no known quantum algorithm |
| Oracle key compromise | oracle_key.json must be kept offline and secure |

---

---

## Gas Benchmark

Execution resources from a live `publish_recall` transaction on StarkNet Sepolia.
The dominant cost is Falcon-512 polynomial arithmetic (NTT operations) inside `verify_uncompressed`.

### publish_recall — Execution Resources

> Snapshot from [Voyager](https://sepolia.voyager.online/tx/0x4c831432039bfaf4ba19f70909e9f875fa426285e7ae7c1f9b6493614d7aabe)

| Metric | Value |
|--------|-------|
| Actual Fee | 2.46 STRK ($0.093) |
| L1 Gas | 0 |
| L1 Data Gas | 1,152 |
| L2 Gas | 307,911,360 |
| Block | 7296415 (Mar 06 2026) |

### verify_data_integrity — Execution Resources

> Lightweight read call — Poseidon hash comparison only, no Falcon arithmetic.
> Snapshot from [Voyager](https://sepolia.voyager.online/tx/0x7dd97b554c1b270a3f580513066307a3cb898f73e5b2cf5b5cd0fb0b97f0ed2)

| Metric | Value |
|--------|-------|
| Actual Fee | 0.0280 STRK ($0.0003) |
| L1 Gas | 0 |
| L1 Data Gas | 128 |
| L2 Gas | 1,000,960 |
| Block | 7336561 (Mar 07 2026) |

### Notes

- Falcon-512 verification is the dominant cost — NTT polynomial multiplication over Z_12289
- `hash_to_point_poseidon` (512 Poseidon calls) is cheap relative to `verify_uncompressed`
- Poseidon is a Cairo VM builtin — no simulation cost
- StarkNet's STARK proof compression makes Falcon-512 economically viable on L2
