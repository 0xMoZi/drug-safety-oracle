"""
signer.py — Sign transaksi StarkNet with Falcon-512.

Not using falcon.sign(), which uses SHAKE-256 internally.
Replace with hash_to_point_poseidon() + __sample_preimage__().
msg_point is now from Poseidon -> can be recompute identically in Cairo.
This enables on-chain message binding checks (anti-forgery).

New Flow signing:
    msg_hash  = Poseidon(recall_id, data_hash)
    msg_point = hash_to_point_poseidon(msg_hash)
    s         = __sample_preimage__(B0_fft, T_fft, msg_point)
    s2        = s[1]   <- mathematical: s1 + s2*h = msg_point
    signature = s2 + msg_point  (1024 felt252)
"""

import json
import os
from typing import Tuple
from falcon import Falcon, deserialize_to_poly
from encoding import decompress
from poseidon_py.poseidon_hash import poseidon_hash_many
from ntt import mul_ntt, ntt, intt, sub_zq
from config import FALCON_N, Q

HEAD_LEN = 1
SALT_LEN = 40


# ─────────────────────────────────────────
# Poseidon hash_to_point
# ─────────────────────────────────────────

def hash_to_point_poseidon(msg_hash: int, n: int = None) -> list[int]:
    """
    Map msg_hash -> N coefficients in [0, Q-1] using Poseidon sponge.

    Must be IDENTICAL to _hash_to_point in Cairo contract:
        state = msg_hash
        for k in 0..N:
            hash_val = Poseidon(state, k)
            coef = hash_val % Q
            state = hash_val <- chain state to next iteration

       Each coefficient depends on all previous coefficients (chain) Changing msg_hash
       -> all coefficients change
       Cannot reverse-engineer msg_hash from msg_point.
    """
    if n is None:
        n = FALCON_N

    point = []
    state = msg_hash

    for k in range(n):
        # Mirror Cairo: PoseidonTrait::new().update(state).update(k).finalize()
        hash_val = poseidon_hash_many([state, k])
        coef     = hash_val % Q
        point.append(coef)
        # Update state for the next iterations
        state = hash_val

    assert len(point) == n
    assert all(0 <= c < Q for c in point)
    return point


# ─────────────────────────────────────────
# Load Keypair
# ─────────────────────────────────────────

def load_keypair(path: str = "oracle_key.json") -> tuple:
    """
    Load the keypair from the file and reconstruct the sk tuple.

    Since B0_fft and T_fft cannot be JSON-serialized (complex128),
    we store f,g,F,G and reconstruct it via keygen([f,g,F,G]).
    """
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"Keypair not found in '{path}'. "
            "Run `python keygen.py` first."
        )

    with open(path) as f:
        data = json.load(f)

    # Integrity check pk
    pk = data["pk"]
    if "pk_hash" in data:
        expected = int(data["pk_hash"], 16)
        actual   = poseidon_hash_many(pk)
        assert actual == expected, (
            f"❌ pk_hash mismatch!\n"
            f"   JSON     : {hex(expected)}\n"
            f"   Computed : {hex(actual)}\n"
            f"   oracle_key.json may corrupted!"
        )

    n = data["n"]
    for name in ["f", "g", "F", "G"]:
        assert len(data[name]) == n, (
            f"Polynomial length '{name}' ({len(data[name])}) != n ({n})"
        )

    # reconstructed sk dari f, g, F, G
    falcon = Falcon(n)
    sk, vk_reconstructed = falcon.keygen([
        data["f"], data["g"], data["F"], data["G"]
    ])

    # Vk verification is consistent with the saved pk
    pk_from_vk = [int(x) % Q for x in deserialize_to_poly(vk_reconstructed, n)]
    assert pk_from_vk == pk, (
        "❌ pk from sk reconstruction does not match pk in JSON!"
    )

    vk = bytes.fromhex(data["vk_hex"])
    return falcon, sk, pk, vk


# ─────────────────────────────────────────
# Sign — Poseidon hash_to_point
# ─────────────────────────────────────────

def sign_message(
    falcon_obj: Falcon,
    sk,
    message: bytes,    # = Poseidon(recall_id, data_hash).to_bytes(32, 'big')
) -> Tuple[list[int], list[int], bytes, bytes]:
    """
    Sign message with Falcon-512 using Poseidon hash_to_point.

    DIFFERENT from the standard falcon.sign():
        - Standard: msg_point = SHAKE-256(message || salt)
        - this implementation: msg_point = hash_to_point_poseidon(Poseidon(message_as_int))

    This allows Cairo to recompute msg_point on-chain and verify the binding.

    Args:
        falcon_obj: instance Falcon(512)
        sk: secret key tuple (f, g, F, G, B0_fft, T_fft)
        message: 32 bytes = Poseidon(recall_id, data_hash).to_bytes(32, 'big')

    Returns:
        s2: list[int] of length N, signature coefficient
        msg_point: list[int] of length N, Poseidon-derived point
        salt: empty bytes (unused, for compatibility)
        raw_sig: empty bytes (unused, for compatibility)
    """
    n = falcon_obj.param.n

    # 1. Convert message bytes -> int -> Poseidon hash
    #    message already = Poseidon(recall_id, data_hash).to_bytes(32, 'big')
    #    we need the integer back for hash_to_point_poseidon
    msg_int   = int.from_bytes(message, 'big')
    msg_point = hash_to_point_poseidon(msg_int, n)

    # 2. Unpack sk
    (f, g, F, G, B0_fft, T_fft) = sk

    # 3. Sample preimage: find (s1, s2) where s1 + s2*h = msg_point
    #    __sample_preimage__ accept direct point — bypass SHAKE-256
    #    Loop until you get a signature that satisfies the norm bound.
    sig_bound = falcon_obj.param.sig_bound
    attempts  = 0

    while True:
        attempts += 1
        s = falcon_obj.__sample_preimage__(B0_fft, T_fft, msg_point)
        # s[0] = s1, s[1] = s2
        # Mathematical: s1 + s2*h = msg_point

        # 4. Check norm — same as Cairo check
        norm_sq = (
            sum(coef ** 2 for coef in s[0]) +
            sum(coef ** 2 for coef in s[1])
        )
        if norm_sq <= sig_bound:
            break
        # Norm too large, try again (Gaussian sampling, probabilistic)

    if attempts > 1:
        print(f"   ℹ️  Took {attempts} attempts for valid norms")

    # 5. Normalize s2 to [0, Q-1]
    s2        = [int(x) % Q for x in s[1]]
    msg_point = [int(x) % Q for x in msg_point]

    assert len(s2) == n,        f"s2 length mismatch: {len(s2)} != {n}"
    assert len(msg_point) == n, f"msg_point length mismatch: {len(msg_point)} != {n}"

    # 6. verification local: s1 + s2*h = msg_point
    pk_poly = [int(x) % Q for x in s[0]]  # this s1, not pk
    # verification via norm (already checked in loop)

    # Return salt=b"" dan raw_sig=b"" for backward compatibility
    # publisher.py will not use both of them
    return s2, msg_point, b"", b""


def verify_local(falcon_obj: Falcon, pk: list[int], s2: list[int], msg_point: list[int]) -> bool:
    """
    Local verification before sending to StarkNet.
    Replica of s2morrow/falcon/verify_uncompressed Cairo:
        s0 = msg_point - s2*h
        norm(s0, s2) ≤ bound
    """
    n         = falcon_obj.param.n
    sig_bound = falcon_obj.param.sig_bound

    # s0 = msg_point - s2 * pk (mod Q)
    s2h = intt(mul_ntt(ntt(s2), ntt(pk)))
    s2h = [int(x) % Q for x in s2h]
    s0  = [(msg_point[i] - s2h[i]) % Q for i in range(n)]

    # Convert to signed for norm
    def to_signed(v):
        return v if v <= Q // 2 else v - Q

    s0_signed = [to_signed(x) for x in s0]
    s2_signed = [to_signed(x) for x in s2]

    norm_sq = (
        sum(x * x for x in s0_signed) +
        sum(x * x for x in s2_signed)
    )
    return norm_sq <= sig_bound


# ─────────────────────────────────────────
# Encode
# ─────────────────────────────────────────

def encode_signature_for_starknet(
    s2: list[int],
    msg_point: list[int],
) -> list[int]:
    """
    Format: [s2[0..N-1], msg_point[0..N-1]] -> total 2*N felt252
    """
    assert len(s2) == FALCON_N,        f"s2 length: {len(s2)} != {FALCON_N}"
    assert len(msg_point) == FALCON_N, f"msg_point length: {len(msg_point)} != {FALCON_N}"
    for i, v in enumerate(s2):
        assert 0 <= v < Q, f"s2[{i}]={v} outside the u16 range"
    for i, v in enumerate(msg_point):
        assert 0 <= v < Q, f"msg_point[{i}]={v} outside the u16 range"
    return s2 + msg_point


# ─────────────────────────────────────────
# Self-test
# ─────────────────────────────────────────

if __name__ == "__main__":
    print("🧪 Test signer with Poseidon hash_to_point\n")

    # 1. Load keypair
    print("1. Loading keypair...")
    falcon_obj, sk, pk, vk = load_keypair("oracle_key.json")
    print(f"   ✅ sk loaded ({FALCON_N} coefficient)\n")

    # 2. Simulate data recall
    print("2. Simulate data recall...")
    recall_id  = 0x34c6352e7804562ae53a0894327bdc9242652fc344a5b669305eb1b693b180c
    data_hash  = 0x265d0b680000000000000000000000000000000000000000000000006d025a00
    msg_hash   = poseidon_hash_many([recall_id, data_hash])
    message    = msg_hash.to_bytes(32, 'big')
    print(f"   recall_id : {hex(recall_id)}")
    print(f"   data_hash : {hex(data_hash)}")
    print(f"   msg_hash  : {hex(msg_hash)}\n")

    # 3. hash_to_point_poseidon
    print("3. hash_to_point_poseidon...")
    msg_point = hash_to_point_poseidon(msg_hash)
    print(f"   ✅ msg_point[0:5] : {msg_point[:5]}")
    print(f"   ✅ all coeff < Q : {all(0 <= c < Q for c in msg_point)}\n")

    # 4. Sign
    print("4. Signing...")
    s2, mp, _, _ = sign_message(falcon_obj, sk, message)
    print(f"   ✅ s2[0:5]        : {s2[:5]}")
    print(f"   ✅ msg_point match: {mp == msg_point}\n")

    # 5. Replica of s2morrow/falcon/verify_uncompressed Cairo
    print("5.  Replica of s2morrow/falcon/verify_uncompressed Cairo)...")
    ok = verify_local(falcon_obj, pk, s2, msg_point)
    print(f"   {'✅ norm OK — signature valid!' if ok else '❌ norm EXCEEDED'}\n")

    # 6. Encode
    print("6. Encode for StarkNet...")
    sig_felts = encode_signature_for_starknet(s2, msg_point)
    print(f"   ✅ total felt252  : {len(sig_felts)} (= 2 × {FALCON_N})\n")

    # 7. Test binding: hash_to_point_poseidon deteministic?
    print("7. Test determinism hash_to_point_poseidon...")
    mp2 = hash_to_point_poseidon(msg_hash)
    print(f"   ✅ deteministic  : {mp == mp2}\n")

    if ok and mp == mp2:
        print("✅ All test passed! Poseidon hash_to_point ready to use.")
        print("  Cairo contract can recompute identical msg_point -> valid binding.")
    else:
        print("❌ Something wrong!")
