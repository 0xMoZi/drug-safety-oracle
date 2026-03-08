/**
 * lib/starknet.ts — StarkNet contract calls via starknet.js
 * Query langsung dari browser, tidak perlu backend.
 */

import { RpcProvider, Contract, cairo, hash, num } from "starknet";

// ─── Config ───────────────────────────────────────────────────────
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL;
const ORACLE_ADDRESS = process.env.NEXT_PUBLIC_ORACLE_ADDRESS;
const IPFS_GATEWAY = process.env.NEXT_PUBLIC_IPFS_GATEWAY;

// ─── ABI ──────────────────────────────────────────────────────────
const ORACLE_ABI = [
    {
        type: "impl",
        name: "DrugSafetyOracleImpl",
        interface_name: "falcon_account::drug_safety_oracle::IDrugSafetyOracle",
    },
    {
        type: "struct",
        name: "core::byte_array::ByteArray",
        members: [
            {
                name: "data",
                type: "core::array::Array::<core::bytes_31::bytes31>",
            },
            {
                name: "pending_word",
                type: "core::felt252",
            },
            {
                name: "pending_word_len",
                type: "core::internal::bounded_int::BoundedInt::<0, 30>",
            },
        ],
    },
    {
        type: "enum",
        name: "core::bool",
        variants: [
            {
                name: "False",
                type: "()",
            },
            {
                name: "True",
                type: "()",
            },
        ],
    },
    {
        type: "struct",
        name: "falcon_account::drug_safety_oracle::RecallEntry",
        members: [
            {
                name: "drug_name_hash",
                type: "core::felt252",
            },
            {
                name: "data_hash",
                type: "core::felt252",
            },
            {
                name: "status",
                type: "core::integer::u8",
            },
            {
                name: "severity",
                type: "core::integer::u8",
            },
            {
                name: "published_at",
                type: "core::integer::u64",
            },
            {
                name: "is_valid",
                type: "core::bool",
            },
        ],
    },
    {
        type: "interface",
        name: "falcon_account::drug_safety_oracle::IDrugSafetyOracle",
        items: [
            {
                type: "function",
                name: "publish_recall",
                inputs: [
                    {
                        name: "recall_id",
                        type: "core::felt252",
                    },
                    {
                        name: "drug_name_hash",
                        type: "core::felt252",
                    },
                    {
                        name: "data_hash",
                        type: "core::felt252",
                    },
                    {
                        name: "status",
                        type: "core::integer::u8",
                    },
                    {
                        name: "severity",
                        type: "core::integer::u8",
                    },
                    {
                        name: "timestamp",
                        type: "core::integer::u64",
                    },
                    {
                        name: "cid",
                        type: "core::byte_array::ByteArray",
                    },
                    {
                        name: "signature",
                        type: "core::array::Array::<core::felt252>",
                    },
                ],
                outputs: [],
                state_mutability: "external",
            },
            {
                type: "function",
                name: "get_recall",
                inputs: [
                    {
                        name: "recall_id",
                        type: "core::felt252",
                    },
                ],
                outputs: [
                    {
                        type: "falcon_account::drug_safety_oracle::RecallEntry",
                    },
                ],
                state_mutability: "view",
            },
            {
                type: "function",
                name: "get_recall_cid",
                inputs: [
                    {
                        name: "recall_id",
                        type: "core::felt252",
                    },
                ],
                outputs: [
                    {
                        type: "core::byte_array::ByteArray",
                    },
                ],
                state_mutability: "view",
            },
            {
                type: "function",
                name: "get_recall_count",
                inputs: [],
                outputs: [
                    {
                        type: "core::integer::u32",
                    },
                ],
                state_mutability: "view",
            },
            {
                type: "function",
                name: "get_recall_id_by_index",
                inputs: [
                    {
                        name: "idx",
                        type: "core::integer::u32",
                    },
                ],
                outputs: [
                    {
                        type: "core::felt252",
                    },
                ],
                state_mutability: "view",
            },
            {
                type: "function",
                name: "is_recall_active",
                inputs: [
                    {
                        name: "recall_id",
                        type: "core::felt252",
                    },
                ],
                outputs: [
                    {
                        type: "core::bool",
                    },
                ],
                state_mutability: "view",
            },
            {
                type: "function",
                name: "verify_data_integrity",
                inputs: [
                    {
                        name: "recall_id",
                        type: "core::felt252",
                    },
                    {
                        name: "data_hash",
                        type: "core::felt252",
                    },
                ],
                outputs: [
                    {
                        type: "core::bool",
                    },
                ],
                state_mutability: "view",
            },
            {
                type: "function",
                name: "upload_pk_chunk",
                inputs: [
                    {
                        name: "chunk",
                        type: "core::array::Array::<core::integer::u16>",
                    },
                    {
                        name: "offset",
                        type: "core::integer::u32",
                    },
                ],
                outputs: [],
                state_mutability: "external",
            },
            {
                type: "function",
                name: "is_pk_ready",
                inputs: [],
                outputs: [
                    {
                        type: "core::bool",
                    },
                ],
                state_mutability: "view",
            },
            {
                type: "function",
                name: "get_public_key",
                inputs: [],
                outputs: [
                    {
                        type: "core::array::Array::<core::integer::u16>",
                    },
                ],
                state_mutability: "view",
            },
        ],
    },
    {
        type: "constructor",
        name: "constructor",
        inputs: [
            {
                name: "pk_hash",
                type: "core::felt252",
            },
        ],
    },
    {
        type: "event",
        name: "falcon_account::drug_safety_oracle::DrugSafetyOracle::OracleDeployed",
        kind: "struct",
        members: [
            {
                name: "address",
                type: "core::starknet::contract_address::ContractAddress",
                kind: "key",
            },
            {
                name: "pk_hash",
                type: "core::felt252",
                kind: "data",
            },
        ],
    },
    {
        type: "event",
        name: "falcon_account::drug_safety_oracle::DrugSafetyOracle::RecallPublished",
        kind: "struct",
        members: [
            {
                name: "recall_id",
                type: "core::felt252",
                kind: "key",
            },
            {
                name: "drug_name_hash",
                type: "core::felt252",
                kind: "data",
            },
            {
                name: "data_hash",
                type: "core::felt252",
                kind: "data",
            },
            {
                name: "severity",
                type: "core::integer::u8",
                kind: "data",
            },
            {
                name: "timestamp",
                type: "core::integer::u64",
                kind: "data",
            },
            {
                name: "cid",
                type: "core::byte_array::ByteArray",
                kind: "data",
            },
        ],
    },
    {
        type: "event",
        name: "falcon_account::drug_safety_oracle::DrugSafetyOracle::PkChunkUploaded",
        kind: "struct",
        members: [
            {
                name: "offset",
                type: "core::integer::u32",
                kind: "data",
            },
            {
                name: "total_loaded",
                type: "core::integer::u32",
                kind: "data",
            },
        ],
    },
    {
        type: "event",
        name: "falcon_account::drug_safety_oracle::DrugSafetyOracle::Event",
        kind: "enum",
        variants: [
            {
                name: "OracleDeployed",
                type: "falcon_account::drug_safety_oracle::DrugSafetyOracle::OracleDeployed",
                kind: "nested",
            },
            {
                name: "RecallPublished",
                type: "falcon_account::drug_safety_oracle::DrugSafetyOracle::RecallPublished",
                kind: "nested",
            },
            {
                name: "PkChunkUploaded",
                type: "falcon_account::drug_safety_oracle::DrugSafetyOracle::PkChunkUploaded",
                kind: "nested",
            },
        ],
    },
];

// ─── Provider & Contract ─────────────────────────────────────────
let _provider: RpcProvider | null = null;
let _contract: Contract | null = null;

function getProvider(): RpcProvider {
    if (!_provider) {
        _provider = new RpcProvider({ nodeUrl: RPC_URL });
    }
    return _provider;
}

function getContract(): Contract {
    if (!_contract) {
        _contract = new Contract({
            abi: ORACLE_ABI,
            address: ORACLE_ADDRESS,
            providerOrAccount: getProvider(),
        });
    }
    return _contract;
}

// ─── ByteArray Parser ─────────────────────────────────────────────
/**
 * starknet.js mengembalikan ByteArray sebagai object:
 * { data: bigint[], pending_word: bigint, pending_word_len: bigint }
 *
 * Kita decode kembali ke string:
 * - Setiap element di data[] = 31 bytes
 * - pending_word = sisa bytes (< 31)
 */
function decodeByteArray(raw: unknown): string {
    // Kalau starknet.js sudah decode jadi string
    if (typeof raw === "string") return raw;

    // Object format: { data, pending_word, pending_word_len }
    if (raw && typeof raw === "object") {
        const obj = raw as Record<string, unknown>;

        const dataArr: bigint[] = [];
        if (Array.isArray(obj.data)) {
            for (const d of obj.data) dataArr.push(BigInt(d as string));
        }

        const pendingWord = BigInt(
            (obj.pending_word ?? obj.pending_word_felt252 ?? 0) as string,
        );
        const pendingWordLen = Number((obj.pending_word_len ?? 0) as string);

        let result = "";

        // Decode full words (31 bytes each)
        for (const word of dataArr) {
            const bytes = new Uint8Array(31);
            let w = word;
            for (let i = 30; i >= 0; i--) {
                bytes[i] = Number(w & 0xffn);
                w >>= 8n;
            }
            result += new TextDecoder().decode(bytes);
        }

        // Decode pending word
        if (pendingWordLen > 0) {
            const bytes = new Uint8Array(pendingWordLen);
            let w = pendingWord;
            for (let i = pendingWordLen - 1; i >= 0; i--) {
                bytes[i] = Number(w & 0xffn);
                w >>= 8n;
            }
            result += new TextDecoder().decode(bytes);
        }

        return result;
    }

    return String(raw);
}

// ─── Types ────────────────────────────────────────────────────────
export interface OnChainEntry {
    recall_id_felt: string; // hex felt252
    drug_name_hash: string;
    data_hash: string;
    status: number;
    severity: number;
    published_at: number;
    cid: string;
}

export interface RecallData {
    recall_id: string;
    brand_name: string;
    drug_name: string;
    manufacturer: string;
    reason: string;
    status: number;
    severity: number;
    date: string;
}

export interface FullRecall extends OnChainEntry {
    data: RecallData | null;
    ipfs_url: string;
    voyager_url: string;
}

// ─── Contract Calls ───────────────────────────────────────────────

export async function getRecallCount(): Promise<number> {
    const contract = getContract();
    const result = await contract.get_recall_count();
    return Number(result);
}

export async function getRecallIdByIndex(idx: number): Promise<string> {
    const contract = getContract();
    const result = await contract.get_recall_id_by_index(idx);
    return num.toHex(result);
}

export async function getOnChainEntry(
    recallIdFelt: string,
): Promise<OnChainEntry> {
    const contract = getContract();

    const [entry, cidRaw] = await Promise.all([
        contract.get_recall(recallIdFelt),
        contract.get_recall_cid(recallIdFelt),
    ]);

    return {
        recall_id_felt: recallIdFelt,
        drug_name_hash: num.toHex(entry.drug_name_hash),
        data_hash: num.toHex(entry.data_hash),
        status: Number(entry.status),
        severity: Number(entry.severity),
        published_at: Number(entry.published_at),
        cid: decodeByteArray(cidRaw),
    };
}

// ─── IPFS Fetch ───────────────────────────────────────────────────

export async function fetchFromIPFS(cid: string): Promise<RecallData | null> {
    try {
        const resp = await fetch(`${IPFS_GATEWAY}/${cid}`, {
            signal: AbortSignal.timeout(10_000),
        });
        if (!resp.ok) return null;
        return await resp.json();
    } catch {
        return null;
    }
}

export function getIPFSUrl(cid: string): string {
    return `${IPFS_GATEWAY}/${cid}`;
}

export function getVoyagerUrl(txHash: string): string {
    return `https://sepolia.voyager.online/tx/${txHash}`;
}

// ─── High-level: load one recall ─────────────────────────────────

export async function loadRecall(recallIdFelt: string): Promise<FullRecall> {
    const onChain = await getOnChainEntry(recallIdFelt);
    const data = await fetchFromIPFS(onChain.cid);

    return {
        ...onChain,
        data,
        ipfs_url: getIPFSUrl(onChain.cid),
        voyager_url: "", // tidak ada tx_hash di on-chain entry, lihat di Voyager
    };
}

// ─── Load paginated recalls ───────────────────────────────────────

export async function loadRecalls(params: {
    page: number;
    limit: number;
}): Promise<{ recalls: FullRecall[]; total: number; pages: number }> {
    const total = await getRecallCount();
    const pages = Math.ceil(total / params.limit);

    // Index terbaru dulu (descending)
    const start = total - 1 - (params.page - 1) * params.limit;
    const end = Math.max(start - params.limit + 1, 0);

    const indices: number[] = [];
    for (let i = start; i >= end; i--) {
        indices.push(i);
    }

    // Fetch recall_ids parallel
    const recallIds = await Promise.all(
        indices.map((idx) => getRecallIdByIndex(idx)),
    );

    // Fetch on-chain entries parallel
    const onChainEntries = await Promise.all(
        recallIds.map((id) => getOnChainEntry(id)),
    );

    // Fetch IPFS data parallel
    const recalls = await Promise.all(
        onChainEntries.map(async (entry) => {
            const data = await fetchFromIPFS(entry.cid);
            return {
                ...entry,
                data,
                ipfs_url: getIPFSUrl(entry.cid),
                voyager_url: "",
            } as FullRecall;
        }),
    );

    return { recalls, total, pages };
}

// ─── Verify ───────────────────────────────────────────────────────

export async function verifyOnChain(recallIdFelt: string): Promise<{
    authentic: boolean;
    data_hash: string;
    cid: string;
    ipfs_url: string;
    message: string;
}> {
    const onChain = await getOnChainEntry(recallIdFelt);

    // Fetch data dari IPFS
    const ipfsData = await fetchFromIPFS(onChain.cid);
    if (!ipfsData) {
        return {
            authentic: false,
            data_hash: onChain.data_hash,
            cid: onChain.cid,
            ipfs_url: getIPFSUrl(onChain.cid),
            message: "❌ Tidak bisa fetch data dari IPFS",
        };
    }

    // Verify: call contract verify_data_integrity
    const contract = getContract();
    const authentic = await contract.verify_data_integrity(
        recallIdFelt,
        onChain.data_hash,
    );

    return {
        authentic: Boolean(authentic),
        data_hash: onChain.data_hash,
        cid: onChain.cid,
        ipfs_url: getIPFSUrl(onChain.cid),
        message: authentic
            ? "✅ Data authentic — hash verified on-chain, signed with Falcon (post-quantum)"
            : "❌ Hash mismatch — data mungkin telah dimodifikasi",
    };
}

// ─── Helpers ─────────────────────────────────────────────────────

export const STATUS_MAP = {
    0: "Ongoing",
    1: "Terminated",
    2: "Completed",
} as const;
export const SEVERITY_MAP = {
    0: "Class I",
    1: "Class II",
    2: "Class III",
} as const;

export function formatDate(dateStr: string): string {
    if (!dateStr || dateStr.length !== 8) return dateStr ?? "";
    return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
}

export function truncateHex(hex: string, chars = 10): string {
    if (!hex) return "";
    return `${hex.slice(0, chars)}...${hex.slice(-6)}`;
}

export function formatTimestamp(ts: number): string {
    return new Date(ts * 1000).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}
