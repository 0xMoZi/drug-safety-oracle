# config.py — load dari .env di root project
import os
import pathlib
from dotenv import load_dotenv

# Cari .env di root project (2 level up dari signer/)
ROOT = pathlib.Path(__file__).parent.parent
load_dotenv(ROOT / ".env")

def _int(key: str) -> int:
    val = os.environ[key]
    return int(val, 16) if val.startswith("0x") else int(val)

def _str(key: str) -> str:
    return os.environ[key]

FALCON_N            = _int("FALCON_N")
CHUNK_SIZE          = _int("CHUNK_SIZE")
Q                   = _int("Q")
PRIVATE_RPC_URL     = _str("PRIVATE_RPC_URL")
PUBLIC_RPC_URL      = _str("PUBLIC_RPC_URL")
STRK_ADDR           = _int("STRK_ADDR")
# ORACLE_CONTRACT     = _int("ORACLE_CONTRACT") # <- uncomment this after you deployed the contract
FDA_BASE            = _str("FDA_BASE")
IPFS_GATEWAY        = _str("IPFS_GATEWAY")
PINATA_METADATA_URL = _str("PINATA_METADATA_URL")
PINATA_UPLOAD       = _str("PINATA_UPLOAD")
PINATA_JWT          = _str("PINATA_JWT")
