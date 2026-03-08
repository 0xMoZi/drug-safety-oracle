# PQ Drug Safety Oracle

A post-quantum secure (PQS) on-chain oracle that publishes FDA drug recall data to StarkNet, signed with Falcon-512 — a NIST-standardized lattice-based signature algorithm resistant to quantum attacks.

**Live Contract:** [`0x01cdaa7011e...e14d92a`](https://sepolia.voyager.online/contract/0x01cdaa7011e2fef48ec29c3a5408cdcf1bec7c38a1346686867cbd503e14d92a#events) — StarkNet Sepolia  
**Built by:** [@0xMoZi](https://github.com/0xMoZi) · [@MoZi_v1](https://x.com/MoZi_v1)

---

## What It Does

```
FDA drug recall data
    → uploaded to IPFS
    → signed with Falcon-512 (post-quantum, NIST FIPS 206)
    → published on-chain to StarkNet
    → verifiable by anyone, forever
```

No one can publish fake recall data to this contract — not without the Falcon-512 private key, and not even with a quantum computer.

---

## Project Structure

```
drug_safety_oracle/
├── .env                          ← config (never commit)
├── .env.example
├── .gitignore
├── .tool-versions                ← asdf: Scarb + sncast versions
├── Makefile
├── README.md
├── requirements.txt
├── Scarb.toml
├── Scarb.lock
├── snfoundry.toml
├── TECHNICAL.md
│
├── src/
│   ├── drug_safety_oracle.cairo  ← StarkNet contract (main)
│   └── falcon_account.cairo      ← gitignored
│   └── lib.cairo
│
├── signer/
│   ├── oracle_key.json           ← Falcon-512 keypair (never commit)
│   ├── deploy_info.json          ← gitignored
│   ├── common.py
│   ├── config.py
│   ├── deploy.py                 ← upload pk to contract
│   ├── encoding.py
│   ├── falcon.py                 ← Falcon reference implementation
│   ├── ffsampling.py
│   ├── fft.py
│   ├── fft_constants.py
│   ├── keygen.py                 ← generate keypair
│   ├── ntrugen.py
│   ├── ntt.py
│   ├── ntt_constants.py
│   ├── rng.py
│   ├── samplerz.py
│   └── signer.py                 ← Poseidon hash_to_point + signing
│
├── oracle/
│   ├── config.py
│   ├── publisher.py              ← FDA fetch + IPFS upload + publish
│   └── test_binding.py           ← on-chain message binding test (3 vectors)
│
└── frontend/
    ├── .env.local                ← frontend config (never commit)
    ├── .env.local.example
    ├── .gitignore
    ├── next.config.ts
    ├── vercel.json
    ├── package.json
    ├── package-lock.json
    ├── postcss.config.mjs
    ├── tailwind.config.ts
    ├── tsconfig.json
    ├── next-env.d.ts
    ├── public/                   ← static assets (logo, etc.)
    ├── app/
    │   ├── globals.css
    │   ├── icon.png              ← favicon
    │   ├── layout.tsx
    │   ├── page.tsx              ← dashboard
    │   └── recall/[id]/
    │       └── page.tsx          ← recall detail
    └── lib/
        └── starknet.ts           ← starknet.js client (no backend)
```

---

## Installation

### Prerequisites

- [asdf](https://asdf-vm.com/) — for Scarb + sncast version management
- Python 3.10+
- Node.js 24+
- A StarkNet account on Sepolia (via [Argent](https://www.argent.xyz/) or sncast)

### 1. Clone Repositories

```bash
# s2morrow/falcon must be cloned in the same parent directory
git clone https://github.com/starkware-bitcoin/s2morrow
git clone https://github.com/0xMoZi/drug_safety_oracle

ls
# s2morrow/  drug_safety_oracle/
```

### 2. Cairo / StarkNet Tools

```bash
cd drug_safety_oracle
asdf install   # installs Scarb + sncast from .tool-versions
make build     # scarb build — verify it compiles
```

### 3. Python

Install venv in drug_safety_oracle directory

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 4. Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local
# fill in NEXT_PUBLIC_* variables
```

### 5. Pinata Setup

Create an API key at [pinata.cloud](https://pinata.cloud) with:

| Section | Permission |
|---------|-----------|
| V3 Resources — Files | Write |
| V3 Resources — Gateways | Read |
| Legacy Pinning — pinJSONToIPFS | ✅ |
| Legacy Pinning — hashMetadata | ✅ |
| Legacy Data — pinList | ✅ |

Add to `.env`:
```bash
IPFS_GATEWAY=https://<your-gateway>/ipfs
PINATA_JWT=<your-jwt>
```

### 6. Environment Files

```bash
# Root
cp .env.example .env

# Frontend
cp frontend/.env.local.example frontend/.env.local
```

`.env` variables:

```bash
# Falcon
FALCON_N=512
CHUNK_SIZE=512
Q=12289

# StarkNet
# PRIVATE_RPC_URL is aim for publish new recall from openFDA using CLI through publisher.py
# starknet.py is required v0_10, make sure use RPC from alchemy since its support v0_10.
PRIVATE_RPC_URL=
# PUBLIC_RPC_URL is aim for frontend use case.
PUBLIC_RPC_URL=
ACCOUNT=
STRK_ADDR=0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
ORACLE_CONTRACT=
ORACLE_CLASS_HASH=

# FDA + IPFS
FDA_BASE=https://api.fda.gov/drug/enforcement.json
IPFS_GATEWAY=
PINATA_METADATA_URL=
PINATA_UPLOAD=
PINATA_JWT=
```

`.env.local` variables (frontend):
```bash
NEXT_PUBLIC_RPC_URL=
NEXT_PUBLIC_ORACLE_ADDRESS=
NEXT_PUBLIC_IPFS_GATEWAY=
```

---

## Deployment

### Contract

```bash
# Step 1: Generate Falcon-512 keypair
# Must be done BEFORE deploy — pk_hash is needed as constructor argument
make py-keygen-oracle
# → creates signer/oracle_key.json (NEVER commit this file)

# Step 2: Build and declare
make build
make declare-oracle
# → copy class_hash to .env → ORACLE_CLASS_HASH

# Step 3: Deploy
make deploy-oracle
# → copy contract address to .env → ORACLE_CONTRACT

# Step 4: Upload Falcon-512 public key to contract
make py-deploy-oracle
```

### Publishing Recalls

```bash
# Preview — no TX sent
make py-dry-run

# Publish (default: 5 recalls)
make py-publish

# Publish custom amount
make py-publish AMOUNT_RECALL=10

# Verify message binding security (3 attack vectors)
make py-test-binding
```

### Frontend

```bash
# Local dev
make dev
```

Set these in Vercel Project Settings → Environment Variables:
```
NEXT_PUBLIC_RPC_URL
NEXT_PUBLIC_ORACLE_ADDRESS
NEXT_PUBLIC_IPFS_GATEWAY
```

---

## Makefile Reference

```
make build              scarb build
make check-account      view sncast accounts
make declare-oracle     declare contract → get class_hash
make py-keygen-oracle   generate Falcon-512 keypair
make deploy-oracle      deploy contract with pk_hash constructor
make py-deploy-oracle   upload 512 pk coefficients to contract
make check-fda          preview latest recalls from OpenFDA
make py-dry-run         simulate publish (no TX)
make py-publish         publish recalls on-chain
make py-test-binding    verify message binding (3 attack vectors)
make dev                start frontend dev server
```

---

## Security

Only the holder of `signer/oracle_key.json` can publish to this contract. The Falcon-512 public key is stored on-chain and used to verify every signature — no admin keys, no multisig.

See [TECHNICAL.md](./TECHNICAL.md) for full cryptographic design, message binding fix, and threat model.

---

## Dependencies

**Cairo / StarkNet:** `scarb`, `sncast`, [`s2morrow/falcon`](https://github.com/starkware-bitcoin/s2morrow)  
**Python:** [`falcon-py`](https://github.com/tprest/falcon.py.git), `poseidon-py`, `starknet-py`, `httpx`  
**Frontend:** `starknet.js`, `Next.js 14`, `Tailwind CSS`
