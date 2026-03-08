"""
test_binding.py — Verify that message binding works in the contract.

Test cases:
    1. Submit a FALSE msg_point -> the contract must REVERT "Message binding failed"
    2. Submit a FALSE s2 (true msg_point) -> the contract must REVERT "Invalid Falcon signature"
    3. Submit valid data -> the contract must ACCEPT (or "Recall already published" if one already exists)

If test 1 REVERT = binding works
If test 1 ACCEPT = binding DOES NOT work ❌ (vulnerability)
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

from config import PRIVATE_RPC_URL, ORACLE_CONTRACT, FALCON_N, Q
KEY_PATH = os.path.join(os.path.dirname(__file__), '..', 'signer', 'oracle_key.json')

# ─── Helpers ─────────────────────────────────────────────────────

def string_to_felt(s: str) -> int:
    return int(hashlib.sha256(s.encode()).hexdigest(), 16) % (2**251 - 1)

def compute_recall_id(recall_number: str) -> int:
    return string_to_felt(recall_number)

def bytes_to_felts(data: bytes) -> list[int]:
    felts = []
    for i in range(0, len(data), 31):
        felts.append(int.from_bytes(data[i:i+31], 'big'))
    return felts

def compute_cid_hash(cid: str) -> int:
    return poseidon_hash_many(bytes_to_felts(cid.encode()))

def cid_to_calldata(cid: str) -> list[int]:
    data = cid.encode()
    full_words = []
    i = 0
    while i + 31 <= len(data):
        full_words.append(int.from_bytes(data[i:i+31], 'big'))
        i += 31
    pending      = data[i:]
    pending_word = int.from_bytes(pending, 'big') if pending else 0
    return [len(full_words), *full_words, pending_word, len(pending)]

def load_sncast_account(name: str):
    accounts_path = (
        pathlib.Path.home()
        / ".starknet_accounts"
        / "starknet_open_zeppelin_accounts.json"
    )
    with open(accounts_path) as f:
        data = json.load(f)
    for network in ["alpha-sepolia", "sepolia", "testnet"]:
        if network in data and name in data[network]:
            acc = data[network][name]
            return int(acc["address"], 16), int(acc["private_key"], 16)
    raise ValueError(f"Account '{name}' not found")

async def submit_recall(
    account_name: str,
    recall_id: int,
    drug_name_hash: int,
    data_hash: int,
    cid: str,
    signature: list[int],
    label: str,
) -> str:
    """Submit recall to the contract, return 'accepted' / 'duplicate' / 'binding_failed' / 'sig_failed' / error"""
    cid_calldata = cid_to_calldata(cid)
    calldata = [
        recall_id,
        drug_name_hash,
        data_hash,
        0,   # status: Ongoing
        1,   # severity: Class II
        int(time.time()),
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
        await client.wait_for_tx(resp.transaction_hash)
        return f"ACCEPTED — TX {hex(resp.transaction_hash)}"
    except Exception as e:
        err = str(e).lower()
        if "message binding failed" in err or "4d65737361676520" in err:
            return "REVERT: Message binding failed ✅"
        elif "invalid falcon signature" in err or "496e76616c696420" in err:
            return "REVERT: Invalid Falcon signature ✅"
        elif "recall already published" in err or "526563616c6c20" in err:
            return "REVERT: Recall already published"
        else:
            return f"REVERT: {str(e)[:120]}"

# ─── Test Runner ──────────────────────────────────────────────────

async def run(account_name: str):
    print("=" * 60)
    print("🧪 MESSAGE BINDING TEST")
    print("=" * 60)
    print()

    # Load keypair
    falcon_obj, sk, pk, vk = load_keypair(str(KEY_PATH))
    print(f"✅ Keypair loaded (N={FALCON_N})\n")

    # Setup fake data recall for test
    # Use recall_id that never published on-chain
    FAKE_RECALL_ID  = "TEST-BINDING-001"
    FAKE_CID        = "bafkreihtiwdks5wkzvl5gcn5hs4vpmcwtvohlnaacfxftdct2pzair7awa"

    recall_id_felt  = compute_recall_id(FAKE_RECALL_ID)
    drug_name_hash  = string_to_felt("test drug")
    data_hash       = compute_cid_hash(FAKE_CID)
    msg_hash        = poseidon_hash_many([recall_id_felt, data_hash])
    message         = msg_hash.to_bytes(32, 'big')

    print(f"📋 Test data:")
    print(f"   recall_id : {hex(recall_id_felt)}")
    print(f"   data_hash : {hex(data_hash)}")
    print(f"   msg_hash  : {hex(msg_hash)}")
    print()

    # Generate signature valid
    s2, msg_point, _, _ = sign_message(falcon_obj, sk, message)
    assert verify_local(falcon_obj, pk, s2, msg_point), "Local verify failed!"
    valid_sig = encode_signature_for_starknet(s2, msg_point)
    print(f"✅ Valid signature generated (len={len(valid_sig)})\n")

    # ──────────────────────────────────────────────────────────────
    # TEST 1: FAKE msg_point (s2 valid, msg_point modified)
    # Expected: REVERT "Message binding failed"
    # ──────────────────────────────────────────────────────────────
    print("─" * 60)
    print("TEST 1: Submit FAKE msg_point")
    print("  s2 valid, but msg_point changed with random values")
    print("  Expected: REVERT 'Message binding failed'")
    print()

    # Create FAKE msg_point : all coefficients = 1
    fake_msg_point = [1] * FALCON_N
    tampered_sig_1 = s2 + fake_msg_point  # s2 valid, msg_point is FAKE

    result1 = await submit_recall(
        account_name, recall_id_felt, drug_name_hash, data_hash,
        FAKE_CID, tampered_sig_1, "tampered_msg_point"
    )
    print(f"  Result: {result1}")
    passed1 = "binding" in result1.lower()
    print(f"  {'✅ PASS' if passed1 else '❌ FAIL — binding not works!'}")
    print()

    # ──────────────────────────────────────────────────────────────
    # TEST 2: FAKE s2 (msg_point valid, s2 modified)
    # Expected: REVERT "Invalid Falcon signature" (norm check failed)
    # Note: binding check pass first because msg_point is valid,
    #       then norm check failed because s2 is unrelated to msg_point
    # ──────────────────────────────────────────────────────────────
    print("─" * 60)
    print("TEST 2: Submit FAKE s2")
    print("  msg_point valid (from Poseidon), but s2 is replaced with FAKE values")
    print("  Expected: binding PASS, then REVERT 'Invalid Falcon signature'")
    print()

    # Create FAKE s2: all coefficients = 100
    fake_s2        = [100] * FALCON_N
    tampered_sig_2 = fake_s2 + msg_point  # s2 FAKE, msg_point valid

    result2 = await submit_recall(
        account_name, recall_id_felt, drug_name_hash, data_hash,
        FAKE_CID, tampered_sig_2, "tampered_s2"
    )
    print(f"  Result: {result2}")
    passed2 = "falcon" in result2.lower() or "signature" in result2.lower()
    print(f"  {'✅ PASS' if passed2 else '❌ FAIL'}")
    print()

    # ──────────────────────────────────────────────────────────────
    # TEST 3: Signature valid but data_hash is different
    # Attacker try to submit (s2, msg_point) valid from other recall
    # with new recall_id
    # Expected: REVERT "Message binding failed"
    # ──────────────────────────────────────────────────────────────
    print("─" * 60)
    print("TEST 3: Replay attack — (s2, msg_point) valid from other recall")
    print("  Take signature valid, submit with different recall_id")
    print("  Expected: REVERT 'Message binding failed'")
    print()

    # Create different recall_id but use the same signature
    DIFFERENT_RECALL_ID   = "TEST-BINDING-002"
    different_recall_felt = compute_recall_id(DIFFERENT_RECALL_ID)
    # Signature is still from FAKE_RECALL_ID — does not match DIFFERENT_RECALL_ID
    replay_sig = valid_sig

    result3 = await submit_recall(
        account_name, different_recall_felt, drug_name_hash, data_hash,
        FAKE_CID, replay_sig, "replay_attack"
    )
    print(f"  Result: {result3}")
    passed3 = "binding" in result3.lower()
    print(f"  {'✅ PASS' if passed3 else '❌ FAIL — replay attack succed!'}")
    print()

    # ──────────────────────────────────────────────────────────────
    # SUMMARY
    # ──────────────────────────────────────────────────────────────
    print("=" * 60)
    print("📊 SUMMARY")
    print("=" * 60)
    print(f"  Test 1 (fake msg_point)  : {'✅ PASS' if passed1 else '❌ FAIL'}")
    print(f"  Test 2 (fake s2)         : {'✅ PASS' if passed2 else '❌ FAIL'}")
    print(f"  Test 3 (replay attack)   : {'✅ PASS' if passed3 else '❌ FAIL'}")
    print()
    if passed1 and passed2 and passed3:
        print("✅ Message binding works correctly!")
        print("   Contract rejects all forge/replay attempts.")
    else:
        print("❌ There is a failed test — check contract implementation!")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--account", required=True, help="sncast account name")
    args = parser.parse_args()
    asyncio.run(run(args.account))
