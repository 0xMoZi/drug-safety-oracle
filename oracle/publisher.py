"""
publisher.py — Fetch FDA recall, upload to IPFS, sign Falcon, publish to StarkNet.

Usage:
    python publisher.py --dry-run                            -> fetch + sign, not publish
    python publisher.py --test --account <sncast-account>    -> publish 1 recall
    python publisher.py --limit 5 --account <sncast-account> -> publish 5 recalls

"""

import asyncio
import argparse
import hashlib
import json
import time
import sys
import os
import pathlib
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'signer'))

import httpx
from dataclasses import dataclass
from poseidon_py.poseidon_hash import poseidon_hash_many

from signer import load_keypair, sign_message, encode_signature_for_starknet, verify_local
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.account.account import Account
from starknet_py.net.models import StarknetChainId
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.hash.selector import get_selector_from_name
from starknet_py.net.client_models import Call

# ─────────────────────────────────────────
# Config
# ─────────────────────────────────────────

from config import PRIVATE_RPC_URL, ORACLE_CONTRACT, FDA_BASE, IPFS_GATEWAY, PINATA_UPLOAD, FALCON_N, PINATA_JWT, PINATA_METADATA_URL
KEY_PATH = os.path.join(os.path.dirname(__file__), '..', 'signer', 'oracle_key.json')

# ─────────────────────────────────────────
# On-chain Duplicate Check
# ─────────────────────────────────────────

async def is_published_onchain(recall_id: int) -> bool:
    client = FullNodeClient(node_url=PRIVATE_RPC_URL)
    call   = Call(
        to_addr=ORACLE_CONTRACT,
        selector=get_selector_from_name("get_recall"),
        calldata=[recall_id],
    )
    try:
        result   = await client.call_contract(call)
        # RecallEntry: [drug_name_hash, data_hash, status, severity, published_at, is_valid]
        is_valid = bool(result[-1])
        return is_valid
    except Exception:
        # Contract panic "Recall not found" -> Not published yet
        return False


# ─────────────────────────────────────────
# Account Loader
# ─────────────────────────────────────────

def load_sncast_account(name: str) -> tuple[int, int]:
    accounts_path = (
        pathlib.Path.home()
        / ".starknet_accounts"
        / "starknet_open_zeppelin_accounts.json"
    )
    if not accounts_path.exists():
        raise FileNotFoundError(f"File tidak ditemukan: {accounts_path}")

    with open(accounts_path) as f:
        data = json.load(f)

    for network in ["alpha-sepolia", "sepolia", "testnet"]:
        if network in data and name in data[network]:
            acc = data[network][name]
            print(f"✅ Account '{name}' loaded from {network}")
            print(f"   Address: {acc['address']}")
            return int(acc["address"], 16), int(acc["private_key"], 16)

    available = list(data.get("alpha-sepolia", {}).keys())
    raise ValueError(f"Account '{name}' not found. Available: {available}")

# ─────────────────────────────────────────
# Data Model
# ─────────────────────────────────────────

@dataclass
class FDARecall:
    recall_number:          str
    product_description:    str
    recalling_firm:         str
    reason_for_recall:      str
    status:                 str
    classification:         str
    recall_initiation_date: str

# ─────────────────────────────────────────
# Fetcher
# ─────────────────────────────────────────

async def fetch_recent_recalls(limit: int = 5) -> list[FDARecall]:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(FDA_BASE, params={
            "limit": limit,
            "sort":  "recall_initiation_date:desc",
        })
        resp.raise_for_status()
        data = resp.json()

    results = []
    for item in data.get("results", []):
        results.append(FDARecall(
            recall_number=          item.get("recall_number", "UNKNOWN"),
            product_description=    item.get("product_description", "")[:150],
            recalling_firm=         item.get("recalling_firm", "")[:100],
            reason_for_recall=      item.get("reason_for_recall", "")[:200],
            status=                 item.get("status", "Ongoing"),
            classification=         item.get("classification", "Class II"),
            recall_initiation_date= item.get("recall_initiation_date", ""),
        ))
    return results

# ─────────────────────────────────────────
# Processor
# ─────────────────────────────────────────

def normalize_status(status: str) -> int:
    return {"Ongoing": 0, "Terminated": 1, "Completed": 2}.get(status, 0)

def normalize_severity(classification: str) -> int:
    return {"Class I": 0, "Class II": 1, "Class III": 2}.get(classification, 1)

def string_to_felt(s: str) -> int:
    return int(hashlib.sha256(s.encode()).hexdigest(), 16) % (2**251 - 1)

def compute_recall_id(recall_number: str) -> int:
    return string_to_felt(recall_number)

def compute_drug_name_hash(drug_name: str) -> int:
    return string_to_felt(drug_name.lower().strip())

def bytes_to_felts(data: bytes) -> list[int]:
    felts = []
    for i in range(0, len(data), 31):
        chunk = data[i:i+31]
        felts.append(int.from_bytes(chunk, 'big'))
    return felts

def compute_cid_hash(cid: str) -> int:
    """data_hash = Poseidon(CID as felts)"""
    return poseidon_hash_many(bytes_to_felts(cid.encode()))

def normalize_recall(recall: FDARecall) -> dict:
    return {
        "recall_id":    recall.recall_number,
        "drug_name":    recall.product_description,
        "brand_name":   recall.product_description.split(",")[0].strip(),
        "manufacturer": recall.recalling_firm,
        "reason":       recall.reason_for_recall,
        "status":       normalize_status(recall.status),
        "severity":     normalize_severity(recall.classification),
        "date":         recall.recall_initiation_date,
    }

# ─────────────────────────────────────────
# IPFS Upload
# ─────────────────────────────────────────

async def upload_to_ipfs(normalized: dict) -> str:
    """Upload normalized recall JSON to Pinata. Return CID."""
    payload = {
        "pinataContent": normalized,
        "pinataMetadata": {
            "name": f"recall-{normalized['recall_id']}",
            "keyvalues": {
                "recall_id":  normalized["recall_id"],
                "severity":   str(normalized["severity"]),
                "status":     str(normalized["status"]),
                "tx_hash":    "pending",   # will updated after TX confirmed
                "network":    "starknet-sepolia",
                "oracle":     "pq-drug-safety-oracle",
                "falcon_n":   str(FALCON_N),
            }
        },
        "pinataOptions": { "cidVersion": 1 }
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            PINATA_UPLOAD,
            json=payload,
            headers={
                "Authorization": f"Bearer {PINATA_JWT}",
                "Content-Type":  "application/json",
            }
        )
        resp.raise_for_status()
        cid = resp.json()["IpfsHash"]

    print(f"   📦 IPFS CID   : {cid}")
    print(f"   🔗 {IPFS_GATEWAY}/{cid}")
    return cid


async def update_ipfs_metadata(cid: str, tx_hash: str) -> None:
    """
    Update Pinata metadata after TX confirmed.
    Add tx_hash and voyager link to keyvalues.
    """
    payload = {
        "ipfsPinHash": cid,
        "keyvalues": {
            "tx_hash":     tx_hash,
            "voyager_url": f"https://sepolia.voyager.online/tx/{tx_hash}",
            "status":      "confirmed",
        }
    }

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.put(
            PINATA_METADATA_URL,
            json=payload,
            headers={
                "Authorization": f"Bearer {PINATA_JWT}",
                "Content-Type":  "application/json",
            }
        )
        if resp.status_code == 200:
            print(f"   🏷️  Pinata metadata updated — tx_hash: {tx_hash[:20]}...")
        else:
            print(f"   ⚠️  Metadata update failed: {resp.status_code}")

# ─────────────────────────────────────────
# Signer
# ─────────────────────────────────────────

def sign_recall(falcon_obj, sk, vk, recall_id: int, data_hash: int) -> list[int]:
    """
    Sign with Falcon-N (N from .env).
    use Poseidon hash_to_point + __sample_preimage__ (not falcon.sign).
    Local verification with verify_local (Cairo replica verify_uncompressed).
    """
    from config import FALCON_N as N
    msg_int = poseidon_hash_many([recall_id, data_hash])
    message = msg_int.to_bytes(32, 'big')

    s2, msg_point, _, _ = sign_message(falcon_obj, sk, message)

    # Local verification: Cairo replica verify_uncompressed
    # (not falcon.verify because raw_sig is no longer generated)
    from signer import verify_local
    # load pk from keypair file
    import json, pathlib
    key_path = pathlib.Path(__file__).parent.parent / "signer" / "oracle_key.json"
    with open(key_path) as f:
        pk = json.load(f)["pk"]

    ok = verify_local(falcon_obj, pk, s2, msg_point)
    assert ok, "❌ Local norm verify FAILED — not published!"

    print(f"   ✅ Falcon-{FALCON_N} signature verified locally")
    sig = encode_signature_for_starknet(s2, msg_point)
    print(f"   📏 Signature length: {len(sig)} felt252 (expected {2 * FALCON_N})")
    return sig

# ─────────────────────────────────────────
# CID -> ByteArray calldata
# ─────────────────────────────────────────

def cid_to_calldata(cid: str) -> list[int]:
    """Encode CID string as Cairo ByteArray calldata."""
    data       = cid.encode()
    full_words = []
    i = 0
    while i + 31 <= len(data):
        full_words.append(int.from_bytes(data[i:i+31], 'big'))
        i += 31

    pending      = data[i:]
    pending_word = int.from_bytes(pending, 'big') if pending else 0
    pending_len  = len(pending)

    return [len(full_words), *full_words, pending_word, pending_len]

# ─────────────────────────────────────────
# Publisher
# ─────────────────────────────────────────

async def publish_recall(
    normalized: dict,
    cid: str,
    signature: list[int],
    timestamp: int,
    account_name: str,
    dry_run: bool = False,
) -> str | None:
    recall_id      = compute_recall_id(normalized["recall_id"])
    data_hash      = compute_cid_hash(cid)
    drug_name_hash = compute_drug_name_hash(normalized["drug_name"])

    print(f"   recall_id     : {hex(recall_id)}")
    print(f"   data_hash     : {hex(data_hash)}")
    print(f"   drug_name_hash: {hex(drug_name_hash)}")
    print(f"   cid           : {cid}")
    print(f"   status        : {normalized['status']}")
    print(f"   severity      : {normalized['severity']}")
    print(f"   timestamp     : {timestamp}")
    print(f"   sig length    : {len(signature)} felt252")

    if dry_run:
        print("   [DRY RUN] — not published on-chain")
        return None

    cid_calldata = cid_to_calldata(cid)

    calldata = [
        recall_id,
        drug_name_hash,
        data_hash,
        normalized["status"],
        normalized["severity"],
        timestamp,
        *cid_calldata,
        len(signature),
        *signature,
    ]

    call = Call(
        to_addr=ORACLE_CONTRACT,
        selector=get_selector_from_name("publish_recall"),
        calldata=calldata,
    )

    address, privkey = load_sncast_account(account_name)
    client  = FullNodeClient(node_url=PRIVATE_RPC_URL)
    account = Account(
        client=client,
        address=address,
        key_pair=KeyPair.from_private_key(privkey),
        chain=StarknetChainId.SEPOLIA,
    )

    try:
        resp = await account.execute_v3(calls=[call], auto_estimate=True)
    except Exception as e:
        err = str(e)
        if "already published" in err.lower() or "526563616c6c20616c7265616479" in err:
            print(f"   \u23ed\ufe0f  Skip \u2014 already in the contract (cache missing)")
            return "ALREADY_PUBLISHED"
        raise

    tx_hash = hex(resp.transaction_hash)
    print(f"   📡 TX sent    : {tx_hash}")
    await client.wait_for_tx(resp.transaction_hash)
    print(f"   ✅ TX confirmed!")
    print(f"   🔗 https://sepolia.voyager.online/tx/{tx_hash}")
    return tx_hash

# ─────────────────────────────────────────
# Main
# ─────────────────────────────────────────

async def run(limit: int = 1, dry_run: bool = False, account_name: str = None):
    print(f"🔐 Loading Falcon-{FALCON_N} keypair...")
    falcon_obj, sk, pk, vk = load_keypair(str(KEY_PATH))
    print(f"✅ Keypair loaded ({len(pk)} coefficient)\n")

    print(f"📡 Fetching {limit} recall(s) from OpenFDA...")
    recalls = await fetch_recent_recalls(limit=limit)
    print(f"✅ Got {len(recalls)} recalls\n")

    published = []

    for i, recall in enumerate(recalls):
        print(f"{'='*55}")
        print(f"📦 Recall {i+1}/{len(recalls)}: {recall.recall_number}")
        print(f"   Drug    : {recall.product_description[:60]}...")
        print(f"   Severity: {recall.classification}")
        print(f"   Status  : {recall.status}")
        print()

        normalized = normalize_recall(recall)
        recall_id  = compute_recall_id(normalized["recall_id"])
        cache_dir  = os.path.dirname(os.path.abspath(__file__))
        cache_path = os.path.join(cache_dir, f"oracle_cache_{recall.recall_number.replace('-', '_')}.json")

        if not dry_run:
            print(f"   🔍 Checking on-chain...")
            already = await is_published_onchain(recall_id)
            if already:
                print(f"   ⏭️  Skip — already in the on-chain contract")
                print()
                continue
            print(f"   ✅ Not yet published, proceeding...")
            print()

        timestamp = int(time.time())

        # Step 1: Upload ke IPFS
        if dry_run:
            cid = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"
            print(f"   [DRY RUN] IPFS CID: {cid}")
        else:
            print(f"📤 Uploading ke IPFS...")
            cid = await upload_to_ipfs(normalized)
        print()

        data_hash = compute_cid_hash(cid)

        # Step 2: Sign with Falcon
        print(f"🔏 Signing with Falcon-{FALCON_N}...")
        signature = sign_recall(falcon_obj, sk, vk, recall_id, data_hash)
        print()

        # Step 3: Publish to StarkNet
        print(f"📤 Publishing to StarkNet...")
        tx_hash = await publish_recall(
            normalized, cid, signature,
            timestamp=timestamp,
            account_name=account_name,
            dry_run=dry_run,
        )
        print()

        if tx_hash and tx_hash != "ALREADY_PUBLISHED":
            # Step 4: Update Pinata metadata with tx_hash
            print(f"🏷️  Updating IPFS metadata...")
            await update_ipfs_metadata(cid, tx_hash)
            print()

            # Saved cache
            cache_data = {
                "recall_id":    hex(recall_id),
                "data_hash":    hex(data_hash),
                "cid":          cid,
                "ipfs_url":     f"{IPFS_GATEWAY}/{cid}",
                "tx_hash":      tx_hash,
                "voyager_url":  f"https://sepolia.voyager.online/tx/{tx_hash}",
                "normalized":   normalized,
                "published_at": timestamp,
                "falcon_n":     FALCON_N,
            }
            with open(cache_path, "w") as f:
                json.dump(cache_data, f, indent=2)
            print(f"   💾 Cache Saved: {cache_path}")
            published.append(cache_data)

        print()

    print(f"✅ Done! {len(published)}/{len(recalls)} recall published.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="PQ Drug Safety Oracle Publisher")
    parser.add_argument("--dry-run", action="store_true", help="Fetch + sign, not Published")
    parser.add_argument("--test",    action="store_true", help="Publish 1 recall for test")
    parser.add_argument("--limit",   type=int, default=1, help="Amount recall (default: 1)")
    parser.add_argument("--account", help="sncast account name")
    args = parser.parse_args()

    if not args.dry_run and not args.account:
        parser.error("--account mandatory. Instance: --account mozi")

    if args.dry_run:
        print(f"🧪 DRY RUN MODE — no TX sent\n")

    asyncio.run(run(
        limit=args.limit,
        dry_run=args.dry_run,
        account_name=args.account,
    ))
