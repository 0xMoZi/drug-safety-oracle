"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
    loadRecalls,
    STATUS_MAP,
    formatDate,
    truncateHex,
    type FullRecall,
} from "@/lib/starknet";

const ORACLE_ADDRESS = process.env.NEXT_PUBLIC_ORACLE_ADDRESS;

function SeverityBadge({ severity }: { severity: number }) {
    const config = {
        0: {
            label: "Class I",
            bg: "bg-red-50",
            text: "text-red-700",
            dot: "bg-red-500",
            border: "border-red-200",
        },
        1: {
            label: "Class II",
            bg: "bg-amber-50",
            text: "text-amber-700",
            dot: "bg-amber-500",
            border: "border-amber-200",
        },
        2: {
            label: "Class III",
            bg: "bg-emerald-50",
            text: "text-emerald-700",
            dot: "bg-emerald-500",
            border: "border-emerald-200",
        },
    }[severity] ?? {
        label: "Unknown",
        bg: "bg-slate-50",
        text: "text-slate-600",
        dot: "bg-slate-400",
        border: "border-slate-200",
    };
    return (
        <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${config.bg} ${config.text} ${config.border}`}
        >
            <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
            {config.label}
        </span>
    );
}

function RecallCard({ recall, index }: { recall: FullRecall; index: number }) {
    return (
        <Link href={`/recall/${encodeURIComponent(recall.recall_id_felt)}`}>
            <div
                className="bg-white border border-slate-200 rounded-xl p-5 hover:border-blue-300 hover:shadow-md transition-all duration-200 cursor-pointer group animate-slide-up flex flex-col h-full min-h-[220px]"
                style={{
                    animationDelay: `${index * 40}ms`,
                    animationFillMode: "both",
                }}
            >
                {/* Top: badges + recall ID */}
                <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2 flex-wrap">
                        <SeverityBadge severity={recall.severity} />
                        <span
                            className={`text-xs font-medium ${recall.status === 0 ? "text-red-600" : recall.status === 1 ? "text-slate-500" : "text-emerald-600"}`}
                        >
                            {STATUS_MAP[
                                recall.status as keyof typeof STATUS_MAP
                            ] ?? "Unknown"}
                        </span>
                    </div>
                    <span className="font-mono text-xs text-slate-400 shrink-0">
                        {recall.data?.recall_id ??
                            truncateHex(recall.recall_id_felt)}
                    </span>
                </div>

                {/* Middle: brand + manufacturer + reason — flex-1 so that the height is consistent */}
                <div className="flex-1">
                    <h3 className="font-serif text-lg text-slate-900 leading-snug mb-1 group-hover:text-blue-700 transition-colors line-clamp-1">
                        {recall.data?.brand_name ?? "—"}
                    </h3>
                    <p className="text-xs text-slate-500 mb-3 line-clamp-1">
                        {recall.data?.manufacturer ?? ""}
                    </p>
                    <p className="text-sm text-slate-600 line-clamp-2 leading-relaxed">
                        {recall.data?.reason ?? ""}
                    </p>
                </div>

                {/* Bottom: hash + date — always under */}
                <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-100">
                    <div className="flex items-center gap-1.5 min-w-0">
                        <span className="inline-flex w-4 h-4 shrink-0 rounded-full bg-blue-50 border border-blue-200 items-center justify-center">
                            <svg
                                className="w-2.5 h-2.5 text-blue-600"
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
                        </span>
                        <span className="font-mono text-xs text-slate-400 truncate">
                            {truncateHex(recall.data_hash)}
                        </span>
                    </div>
                    <span className="text-xs text-slate-400 shrink-0 ml-2">
                        {formatDate(recall.data?.date ?? "")}
                    </span>
                </div>
            </div>
        </Link>
    );
}

function CardSkeleton() {
    return (
        <div className="bg-white border border-slate-200 rounded-xl p-5 animate-pulse">
            <div className="h-4 bg-slate-100 rounded w-24 mb-3" />
            <div className="h-6 bg-slate-100 rounded w-3/4 mb-2" />
            <div className="h-3 bg-slate-100 rounded w-1/2 mb-3" />
            <div className="h-3 bg-slate-100 rounded w-full mb-1" />
            <div className="h-3 bg-slate-100 rounded w-5/6" />
        </div>
    );
}

export default function DashboardPage() {
    const [allRecalls, setAllRecalls] = useState<FullRecall[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [query, setQuery] = useState("");
    const [severity, setSeverity] = useState<number | "">("");
    const [status, setStatus] = useState<number | "">("");
    const limit = 12;

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const result = await loadRecalls({ page, limit });
            setAllRecalls(result.recalls);
            setTotal(result.total);
            setPages(result.pages);
        } catch (e) {
            setError("Failed to load from StarkNet. Try refresh.");
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [page]);

    useEffect(() => {
        load();
    }, [load]);

    const filtered = useMemo(() => {
        return allRecalls.filter((r) => {
            if (severity !== "" && r.severity !== severity) return false;
            if (status !== "" && r.status !== status) return false;
            if (query) {
                const q = query.toLowerCase();
                const hit = [
                    r.data?.brand_name,
                    r.data?.drug_name,
                    r.data?.manufacturer,
                    r.data?.recall_id,
                ].some((f) => f?.toLowerCase().includes(q));
                if (!hit) return false;
            }
            return true;
        });
    }, [allRecalls, query, severity, status]);

    const activeCount = allRecalls.filter((r) => r.status === 0).length;
    const classICount = allRecalls.filter((r) => r.severity === 0).length;
    const classIICount = allRecalls.filter((r) => r.severity === 1).length;
    const hasFilter = query || severity !== "" || status !== "";

    return (
        <div className="min-h-screen">
            <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
                <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <img
                            src="/logo.svg"
                            alt="Logo"
                            className="w-16 h-10 object-contain"
                        />
                        <span className="font-serif text-lg text-slate-900">
                            PQ Drug Safety Oracle
                        </span>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            <span className="text-xs text-slate-500">
                                StarkNet Sepolia
                            </span>
                        </div>
                        <div className="flex items-center gap-1">
                            <a
                                href="https://github.com/0xMoZi"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1.5 text-slate-400 hover:text-slate-700 transition-colors rounded-md hover:bg-slate-100"
                                title="GitHub"
                            >
                                <img
                                    src="/github.svg"
                                    alt="Logo"
                                    className="w-5 h-5 object-contain"
                                />
                            </a>
                            <a
                                href="https://x.com/MoZi_v1"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1.5 text-slate-400 hover:text-slate-700 transition-colors rounded-md hover:bg-slate-100"
                                title="X (Twitter)"
                            >
                                <img
                                    src="/twitter-x.svg"
                                    alt="Logo"
                                    className="w-5 h-5 object-contain"
                                />
                            </a>
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-6 py-8">
                <div className="mb-8 animate-fade-in">
                    <h1 className="font-serif text-4xl text-slate-900 mb-2">
                        Drug Recall Intelligence
                    </h1>
                    <p className="text-slate-500 text-sm max-w-xl">
                        Real-time FDA drug recall data — signed with Falcon
                        post-quantum signatures, stored on IPFS, verified on
                        StarkNet.
                    </p>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8 animate-fade-in">
                    {[
                        {
                            label: "Total On-Chain",
                            value: total,
                            sub: "recalls published",
                            accent: "text-slate-900",
                        },
                        {
                            label: "Active",
                            value: activeCount,
                            sub: "in this page",
                            accent: "text-red-600",
                        },
                        {
                            label: "Class I",
                            value: classICount,
                            sub: "life-threatening",
                            accent: "text-red-600",
                        },
                        {
                            label: "Class II",
                            value: classIICount,
                            sub: "injury possible",
                            accent: "text-amber-600",
                        },
                    ].map((s) => (
                        <div
                            key={s.label}
                            className="bg-white border border-slate-200 rounded-xl p-5"
                        >
                            <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">
                                {s.label}
                            </p>
                            <p className={`font-serif text-3xl ${s.accent}`}>
                                {s.value}
                            </p>
                            <p className="text-xs text-slate-400 mt-1">
                                {s.sub}
                            </p>
                        </div>
                    ))}
                </div>

                {/* Search + Filter */}
                <div className="flex flex-col sm:flex-row gap-3 mb-4">
                    <div className="relative flex-1">
                        <svg
                            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
                            />
                        </svg>
                        <input
                            type="text"
                            placeholder="Search drug name, manufacturer, recall ID..."
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            className="w-full pl-9 pr-4 py-2.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
                        />
                    </div>
                    <select
                        value={severity}
                        onChange={(e) =>
                            setSeverity(
                                e.target.value === ""
                                    ? ""
                                    : Number(e.target.value),
                            )
                        }
                        className="px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400"
                    >
                        <option value="">All Severity</option>
                        <option value="0">Class I — Life-threatening</option>
                        <option value="1">Class II — Injury possible</option>
                        <option value="2">Class III — Least harmful</option>
                    </select>
                    <select
                        value={status}
                        onChange={(e) =>
                            setStatus(
                                e.target.value === ""
                                    ? ""
                                    : Number(e.target.value),
                            )
                        }
                        className="px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400"
                    >
                        <option value="">All Status</option>
                        <option value="0">Ongoing</option>
                        <option value="1">Terminated</option>
                        <option value="2">Completed</option>
                    </select>
                </div>

                {/* Count bar */}
                <div className="flex items-center justify-between mb-4">
                    <p className="text-sm text-slate-500">
                        {loading
                            ? "Loading from StarkNet..."
                            : hasFilter
                              ? `${filtered.length} result${filtered.length !== 1 ? "s" : ""} (filtered from ${allRecalls.length})`
                              : `${total.toLocaleString()} recall${total !== 1 ? "s" : ""} on-chain`}
                    </p>
                    <div className="flex items-center gap-3">
                        {hasFilter && (
                            <button
                                onClick={() => {
                                    setQuery("");
                                    setSeverity("");
                                    setStatus("");
                                }}
                                className="text-xs text-blue-600 hover:underline"
                            >
                                Clear filters
                            </button>
                        )}
                        <a
                            href={`https://sepolia.voyager.online/old-contract/${ORACLE_ADDRESS}#accountCalls`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-slate-400 hover:text-blue-600 flex items-center gap-1 transition-colors"
                        >
                            All TX on Voyager
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

                {error && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                        {error}{" "}
                        <button onClick={load} className="ml-2 underline">
                            Retry
                        </button>
                    </div>
                )}

                {/* Grid */}
                {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <CardSkeleton key={i} />
                        ))}
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="text-center py-20 text-slate-400">
                        <p className="text-lg mb-1">No recalls found</p>
                        <p className="text-sm">
                            {query
                                ? "Try a different search term"
                                : "Run the publisher to add data"}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch">
                        {filtered.map((r, i) => (
                            <RecallCard
                                key={r.recall_id_felt}
                                recall={r}
                                index={i}
                            />
                        ))}
                    </div>
                )}

                {/* Pagination — hide when filtering */}
                {pages > 1 && !hasFilter && (
                    <div className="flex items-center justify-center gap-2 mt-8">
                        <button
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={page === 1}
                            className="px-4 py-2 text-sm border border-slate-200 rounded-lg bg-white hover:border-blue-300 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            Previous
                        </button>
                        <span className="text-sm text-slate-500">
                            Page {page} of {pages}
                        </span>
                        <button
                            onClick={() =>
                                setPage((p) => Math.min(pages, p + 1))
                            }
                            disabled={page === pages}
                            className="px-4 py-2 text-sm border border-slate-200 rounded-lg bg-white hover:border-blue-300 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            Next
                        </button>
                    </div>
                )}
            </main>

            <footer className="border-t border-slate-200 mt-16 py-6">
                <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
                    <p className="text-xs text-slate-400">
                        PQ Drug Safety Oracle — Falcon signatures on StarkNet
                    </p>
                    <p className="text-xs text-slate-400">
                        Data: OpenFDA → IPFS → StarkNet
                    </p>
                </div>
            </footer>
        </div>
    );
}
