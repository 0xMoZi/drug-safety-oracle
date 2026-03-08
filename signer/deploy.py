"""
deploy.py — Generate sncast commands for upload PK to contract.

Usage:
    python deploy.py --address 0x02cdd... --account <sncast-account>
    python deploy.py --address 0x057683... --account <sncast-account> --key oracle_key.json --out signer/deploy_info.json
"""

import json, os, argparse, datetime
from poseidon_py.poseidon_hash import poseidon_hash_many
from config import FALCON_N, CHUNK_SIZE


def load_pk(path: str = "oracle_key.json") -> tuple[list[int], int]:
    """Load pk from JSON with integrity check."""
    with open(path) as f:
        data = json.load(f)

    pk = data["pk"]

    if "pk_hash" in data:
        expected = int(data["pk_hash"], 16)
        actual   = poseidon_hash_many(pk)
        assert actual == expected, (
            f"❌ pk_hash mismatch!\n"
            f"   JSON     : {hex(expected)}\n"
            f"   Computed : {hex(actual)}\n"
            f"   {path} Probably corrupted!"
        )
        print(f"✅ pk integrity check passed ({path})")
        return pk, actual

    return pk, poseidon_hash_many(pk)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--address", required=True, help="Contract address")
    parser.add_argument("--account", default="mozi",           help="sncast account name")
    parser.add_argument("--key",     default="oracle_key.json", help="Keypair file")
    parser.add_argument("--out", default="deploy_info.json", help="Output file path")
    args = parser.parse_args()

    if os.path.exists(args.out):
        print(f"⚠️  {args.out} already available!")
        confirm = input("Re-Generate? (y/N): ").strip()
        if confirm.lower() != "y":
            print("Canceled.")
            exit(0)

    pk, pk_hash = load_pk(args.key)

    assert len(pk) == FALCON_N, f"pk length {len(pk)} != FALCON_N {FALCON_N}"

    chunks = [pk[i:i+CHUNK_SIZE] for i in range(0, len(pk), CHUNK_SIZE)]
    total  = sum(len(c) for c in chunks)
    assert total == FALCON_N, f"Total chunk elements {total} != {FALCON_N}"

    print(f"✅ Public key  : {len(pk)} koefisien")
    print(f"✅ pk_hash     : {hex(pk_hash)}")
    print(f"✅ Contract    : {args.address}")
    print(f"✅ Key file    : {args.key}")
    print(f"✅ Total chunks: {len(chunks)}")
    print()
    print("⚠️  Important: Make sure contract is deployed with:")
    print(f"   --arguments {hex(pk_hash)}")
    print()
    print("=" * 60)
    print("Upload public key chunks — run SEQ from top to bottom")
    print("=" * 60)
    print()

    for idx, chunk in enumerate(chunks):
        offset       = idx * CHUNK_SIZE
        calldata     = [len(chunk)] + chunk + [offset]
        calldata_str = " ".join(str(x) for x in calldata)
        print(f"# Chunk {idx+1}/{len(chunks)} — offset {offset}, {len(chunk)} elements")
        print(f"sncast --account {args.account} invoke \\")
        print(f"  --network sepolia \\")
        print(f"  --contract-address {args.address} \\")
        print(f"  --function upload_pk_chunk \\")
        print(f"  --calldata {calldata_str}")
        print()

    with open(args.out, "w") as f:
        json.dump({
            "pk_hash":          hex(pk_hash),
            "contract_address": args.address,
            "key_file":         args.key,
            "total_chunks":     len(chunks),
            "chunks_uploaded":  0,
            "pk":               pk,
            "deployed_at":      datetime.datetime.now(datetime.UTC).isoformat(),
        }, f, indent=2)

    print("💾 Info saved to: ", args.out)
