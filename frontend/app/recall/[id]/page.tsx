"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
    loadRecall,
    verifyOnChain,
    STATUS_MAP,
    formatDate,
    truncateHex,
    type FullRecall,
} from "@/lib/starknet";

const ORACLE_ADDRESS = process.env.NEXT_PUBLIC_ORACLE_ADDRESS;

function SeverityBadge({ severity }: { severity: number }) {
    const config = {
        0: {
            label: "Class I — Life-threatening",
            bg: "bg-red-50",
            text: "text-red-700",
            border: "border-red-200",
            dot: "bg-red-500",
        },
        1: {
            label: "Class II — Injury possible",
            bg: "bg-amber-50",
            text: "text-amber-700",
            border: "border-amber-200",
            dot: "bg-amber-500",
        },
        2: {
            label: "Class III — Least harmful",
            bg: "bg-emerald-50",
            text: "text-emerald-700",
            border: "border-emerald-200",
            dot: "bg-emerald-500",
        },
    }[severity] ?? {
        label: "Unknown",
        bg: "bg-slate-50",
        text: "text-slate-600",
        border: "border-slate-200",
        dot: "bg-slate-400",
    };
    return (
        <span
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border ${config.bg} ${config.text} ${config.border}`}
        >
            <span className={`w-2 h-2 rounded-full ${config.dot}`} />
            {config.label}
        </span>
    );
}

function HashRow({ label, value }: { label: string; value: string }) {
    const [copied, setCopied] = useState(false);
    const copy = () => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };
    return (
        <div className="flex items-start gap-3 py-3 border-b border-slate-100 last:border-0">
            <span className="text-xs text-slate-500 w-28 shrink-0 pt-0.5">
                {label}
            </span>
            <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="font-mono text-xs text-slate-700 truncate">
                    {value}
                </span>
                <button
                    onClick={copy}
                    className="shrink-0 text-slate-400 hover:text-blue-600 transition-colors"
                >
                    {copied ? (
                        <svg
                            className="w-3.5 h-3.5 text-emerald-500"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2.5}
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M4.5 12.75l6 6 9-13.5"
                            />
                        </svg>
                    ) : (
                        <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184"
                            />
                        </svg>
                    )}
                </button>
            </div>
        </div>
    );
}

function VerifySection({ recallIdFelt }: { recallIdFelt: string }) {
    const [result, setResult] = useState<Awaited<
        ReturnType<typeof verifyOnChain>
    > | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const verify = async () => {
        setLoading(true);
        setError("");
        try {
            setResult(await verifyOnChain(recallIdFelt));
        } catch (e) {
            setError("Verification failed. Check connection to StarkNet.");
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center">
                    <svg
                        className="w-4 h-4 text-blue-600"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 013 10c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
                        />
                    </svg>
                </div>
                <div>
                    <h2 className="font-semibold text-sm text-slate-900">
                        Quantum-Resistant Verification
                    </h2>
                    <p className="text-xs text-slate-500">
                        Verify via StarkNet contract — no backend needed
                    </p>
                </div>
            </div>
            <div className="p-5">
                {!result ? (
                    <>
                        <p className="text-sm text-slate-600 mb-4 leading-relaxed">
                            This data is signed with{" "}
                            <span className="font-medium text-slate-800">
                                Falcon-512
                            </span>{" "}
                            (NIST PQC finalist) and saved on{" "}
                            <span className="font-medium text-slate-800">
                                IPFS
                            </span>
                            . Hashes are verified on-chain on StarkNet.
                        </p>
                        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-4">
                            <p className="text-xs text-blue-700 leading-relaxed">
                                <span className="font-semibold">Flow:</span>{" "}
                                Fetch IPFS → call{" "}
                                <code className="bg-blue-100 px-1 rounded">
                                    verify_data_integrity
                                </code>{" "}
                                on-chain → contract compared hash → true/false.
                            </p>
                        </div>
                        <button
                            onClick={verify}
                            disabled={loading}
                            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <svg
                                        className="w-4 h-4 animate-spin"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                    >
                                        <circle
                                            className="opacity-25"
                                            cx="12"
                                            cy="12"
                                            r="10"
                                            stroke="currentColor"
                                            strokeWidth="4"
                                        />
                                        <path
                                            className="opacity-75"
                                            fill="currentColor"
                                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                                        />
                                    </svg>
                                    Verifying on-chain...
                                </>
                            ) : (
                                "Verify Data Authenticity"
                            )}
                        </button>
                        {error && (
                            <p className="mt-3 text-xs text-red-600">{error}</p>
                        )}
                    </>
                ) : (
                    <div className="animate-fade-in">
                        <div
                            className={`rounded-lg p-4 mb-4 border ${result.authentic ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}
                        >
                            <div className="flex items-center gap-2 mb-1">
                                {result.authentic ? (
                                    <svg
                                        className="w-5 h-5 text-emerald-600"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                        strokeWidth={2.5}
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 013 10c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
                                        />
                                    </svg>
                                ) : (
                                    <svg
                                        className="w-5 h-5 text-red-600"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                        strokeWidth={2.5}
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                                        />
                                    </svg>
                                )}
                                <span
                                    className={`font-semibold text-sm ${result.authentic ? "text-emerald-700" : "text-red-700"}`}
                                >
                                    {result.authentic
                                        ? "Verified Authentic"
                                        : "Verification Failed"}
                                </span>
                            </div>
                            <p
                                className={`text-xs ${result.authentic ? "text-emerald-600" : "text-red-600"}`}
                            >
                                {result.authentic
                                    ? "Data hash match on-chain. Signed with Falcon (post-quantum resistant)."
                                    : "Hash mismatch — data may be modified."}
                            </p>
                        </div>
                        <a
                            href={result.ipfs_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg hover:border-blue-300 transition-colors group mb-3"
                        >
                            <div>
                                <p className="text-xs text-slate-500 mb-0.5">
                                    IPFS Data
                                </p>
                                <p className="font-mono text-xs text-slate-700">
                                    {result.cid.slice(0, 20)}...
                                    {result.cid.slice(-6)}
                                </p>
                            </div>
                            <svg
                                className="w-4 h-4 text-slate-400 group-hover:text-blue-600 transition-colors"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2}
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                                />
                            </svg>
                        </a>
                        <button
                            onClick={() => setResult(null)}
                            className="text-xs text-slate-500 hover:text-slate-700 underline"
                        >
                            Verify again
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function RecallDetailPage() {
    const params = useParams();
    const [recall, setRecall] = useState<FullRecall | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const recallIdFelt = params.id
        ? decodeURIComponent(params.id as string)
        : null;

    useEffect(() => {
        if (!recallIdFelt) return;
        loadRecall(recallIdFelt)
            .then(setRecall)
            .catch((e) => {
                setError("Recall not found.");
                console.error(e);
            })
            .finally(() => setLoading(false));
    }, [recallIdFelt]);

    if (loading || !recallIdFelt)
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                    <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                    <p className="text-xs text-slate-500">
                        Loading from StarkNet + IPFS...
                    </p>
                </div>
            </div>
        );

    if (error || !recall)
        return (
            <div className="min-h-screen flex flex-col items-center justify-center gap-3">
                <p className="text-slate-500">{error || "Recall not found"}</p>
                <Link
                    href="/"
                    className="text-sm text-blue-600 hover:underline"
                >
                    ← Back
                </Link>
            </div>
        );

    const data = recall.data;
    const statusColor =
        recall.status === 0
            ? "text-red-600"
            : recall.status === 1
              ? "text-slate-500"
              : "text-emerald-600";

    // Voyager: search events by recall_id_felt di contract page
    const voyagerContractUrl = `https://sepolia.voyager.online/old-contract/${ORACLE_ADDRESS}#accountCalls`;

    return (
        <div className="min-h-screen">
            <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
                <div className="max-w-5xl mx-auto px-6 h-14 flex items-center gap-4">
                    <Link
                        href="/"
                        className="flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors"
                    >
                        <svg
                            className="w-4 h-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
                            />
                        </svg>
                        <span className="text-sm">Dashboard</span>
                    </Link>
                    <span className="text-slate-300">/</span>
                    <span className="font-mono text-sm text-slate-600">
                        {data?.recall_id ?? truncateHex(recallIdFelt)}
                    </span>
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-6 py-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-slide-up">
                    {/* Left */}
                    <div className="lg:col-span-2 space-y-4">
                        <div className="bg-white border border-slate-200 rounded-xl p-6">
                            <div className="flex items-start gap-3 flex-wrap mb-4">
                                <SeverityBadge severity={recall.severity} />
                                <span
                                    className={`text-sm font-medium ${statusColor}`}
                                >
                                    {STATUS_MAP[
                                        recall.status as keyof typeof STATUS_MAP
                                    ] ?? "Unknown"}
                                </span>
                            </div>
                            <h1 className="font-serif text-3xl text-slate-900 leading-tight mb-1">
                                {data?.brand_name ?? "Loading..."}
                            </h1>
                            <p className="text-sm text-slate-500 mb-4">
                                {data?.manufacturer}
                            </p>
                            <p className="text-xs font-mono text-slate-400 bg-slate-50 rounded px-2 py-1 inline-block">
                                {data?.recall_id ?? recallIdFelt}
                            </p>
                        </div>

                        {data?.reason && (
                            <div className="bg-white border border-slate-200 rounded-xl p-6">
                                <h2 className="text-xs uppercase tracking-wider text-slate-500 mb-3">
                                    Reason for Recall
                                </h2>
                                <p className="text-sm text-slate-700 leading-relaxed">
                                    {data.reason}
                                </p>
                            </div>
                        )}

                        <div className="bg-white border border-slate-200 rounded-xl p-6">
                            <h2 className="text-xs uppercase tracking-wider text-slate-500 mb-3">
                                Product Details
                            </h2>
                            {[
                                ["Full Description", data?.drug_name ?? "—"],
                                ["Manufacturer", data?.manufacturer ?? "—"],
                                ["FDA Date", formatDate(data?.date ?? "")],
                                [
                                    "Published At",
                                    new Date(
                                        recall.published_at * 1000,
                                    ).toLocaleString(),
                                ],
                            ].map(([label, value]) => (
                                <div
                                    key={label}
                                    className="flex gap-3 py-2 border-b border-slate-50 last:border-0"
                                >
                                    <span className="text-xs text-slate-400 w-36 shrink-0">
                                        {label}
                                    </span>
                                    <span className="text-sm text-slate-700">
                                        {value}
                                    </span>
                                </div>
                            ))}
                        </div>

                        <div className="bg-white border border-slate-200 rounded-xl p-6">
                            <h2 className="text-xs uppercase tracking-wider text-slate-500 mb-3">
                                On-Chain Record
                            </h2>
                            <HashRow
                                label="Recall ID felt"
                                value={recall.recall_id_felt}
                            />
                            <HashRow
                                label="Data Hash"
                                value={recall.data_hash}
                            />
                            <HashRow
                                label="Drug Name Hash"
                                value={recall.drug_name_hash}
                            />
                            <HashRow label="IPFS CID" value={recall.cid} />
                            <div className="pt-3 flex flex-wrap gap-4">
                                <a
                                    href={recall.ipfs_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:underline"
                                >
                                    View raw data on IPFS
                                    <svg
                                        className="w-3 h-3"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                        strokeWidth={2}
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                                        />
                                    </svg>
                                </a>
                                <a
                                    href={voyagerContractUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-600 hover:underline"
                                >
                                    View TX history on Voyager
                                    <svg
                                        className="w-3 h-3"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                        strokeWidth={2}
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                                        />
                                    </svg>
                                </a>
                            </div>
                        </div>
                    </div>

                    {/* Right */}
                    <div className="space-y-4">
                        {recallIdFelt && (
                            <VerifySection recallIdFelt={recallIdFelt} />
                        )}
                        <div className="bg-white border border-slate-200 rounded-xl p-5">
                            <h2 className="text-xs uppercase tracking-wider text-slate-500 mb-3">
                                Oracle Info
                            </h2>
                            <div className="space-y-2 text-xs">
                                {[
                                    ["Network", "StarkNet Sepolia"],
                                    ["Signature", "Falcon-512 (PQC)"],
                                    ["Hash function", "Poseidon"],
                                    ["Data storage", "IPFS (Pinata)"],
                                    ["Data source", "OpenFDA"],
                                ].map(([k, v]) => (
                                    <div
                                        key={k}
                                        className="flex justify-between"
                                    >
                                        <span className="text-slate-500">
                                            {k}
                                        </span>
                                        <span className="text-slate-700 font-medium">
                                            {v}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
