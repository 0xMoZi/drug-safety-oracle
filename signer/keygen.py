"""
keygen.py — Generate Falcon keypair for StarkNet Falcon Account.
"""

import json, os, datetime
from falcon import Falcon, deserialize_to_poly
from poseidon_py.poseidon_hash import poseidon_hash_many
from config import FALCON_N, CHUNK_SIZE, Q


def poly_to_int_list(poly, name: str) -> list[int]:
    """Convert polynomial to list int, validate the obvious range."""
    result = [int(round(x)) for x in poly]
    for i, c in enumerate(result):
        assert abs(c) < 2 * Q, f"{name}[{i}]={c} out of range!"
    return result


def normalize_for_cairo(poly) -> list[int]:
    """Normalize coefficient signed -> unsigned [0, Q-1] for Cairo u16."""
    return [int(x) % Q for x in poly]


def generate_keypair(out_path: str = "oracle_key.json"):
    print(f"🔐 Generating Falcon-{FALCON_N} keypair...")

    falcon = Falcon(FALCON_N)
    sk, vk  = falcon.keygen()

    # --- Unpack sk ---
    (poly_f, poly_g, poly_F, poly_G, _B0_fft, _T_fft) = sk
    # B0_fft, T_fft unused: can be reconstructed, cannot JSON-serialize

    # --- Decode public key ---
    pk = normalize_for_cairo(deserialize_to_poly(vk, FALCON_N))

    # --- Calculate pk_hash (Poseidon, same as in the Cairo) ---
    pk_hash = poseidon_hash_many(pk)

    # --- Self-test: sign & verify ---
    test_msg = b"falcon_keygen_selftest_v1"
    test_sig = falcon.sign(sk, test_msg)
    assert falcon.verify(vk, test_msg, test_sig), "❌ Self-test Failed!"
    print("✅ Self-test passed")

    # --- Simpan ---
    key_data = {
        "version":    "1.0",
        "created_at": datetime.datetime.utcnow().isoformat(),
        "algorithm":  f"Falcon-{FALCON_N}",
        "n":          FALCON_N,
        "q":          Q,
        "pk":         pk,
        "pk_hash":    hex(pk_hash),
        "f": poly_to_int_list(poly_f, "f"),
        "g": poly_to_int_list(poly_g, "g"),
        "F": poly_to_int_list(poly_F, "F"),
        "G": poly_to_int_list(poly_G, "G"),
        "vk_hex":     vk.hex(),
    }

    with open(out_path, "w") as f:
        json.dump(key_data, f, indent=2)

        print(f"✅ Keypair created successfully!")
    print(f"📁 Saved to  : {out_path}")
    print(f"🔑 Public key   : {len(pk)} coefficient")
    print(f"🔑 pk_hash      : {hex(pk_hash)}  <- use this for deploy")
    print(f"⚠️  DO NOT share {out_path} to anyone!")

    return falcon, sk, pk, pk_hash


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="oracle_key.json", help="Output file path")
    args = parser.parse_args()

    if os.path.exists(args.out):
        print(f"⚠️  {args.out} already available!")
        confirm = input("Re-Generate? (y/N): ").strip()
        if confirm.lower() != "y":
            print("Canceled.")
            exit(0)

    generate_keypair(out_path=args.out)
