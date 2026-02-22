"use client";

import { useConversation } from "@elevenlabs/react";
import { useState, useCallback, useRef, useMemo, useEffect } from "react";

export type Playbook = {
    id: string;
    version: number;
    strategy: string;
    opener: string;
    objection_style: string;
    tone: string;
    close_technique: string;
    rationale: string;
    created_at: string;
};

export type ImprovementLog = {
    id: string;
    calls_analyzed: number;
    analysis_summary: string | null;
    created_at: string;
};

type Props = {
    initialPlaybooks: Playbook[];
    initialSummary: {
        totalCalls: number;
        analyzedCalls: number;
        latestCall: {
            id: string;
            conversationId: string;
            createdAt: string;
            transcriptPreview: string;
            hasAnalysis: boolean;
        } | null;
    };
};

function SoundBars() {
    return (
        <div className="flex items-end gap-[3px] h-6">
            {[1, 2, 3, 4, 5].map((i) => (
                <div
                    key={i}
                    className={`w-[3px] bg-lime-400 rounded-full bar-${i}`}
                />
            ))}
        </div>
    );
}

const PLAYBOOK_FIELDS: { key: keyof Playbook; label: string }[] = [
    { key: "strategy", label: "Strategy" },
    { key: "opener", label: "Opener" },
    { key: "objection_style", label: "Objection Style" },
    { key: "tone", label: "Tone" },
    { key: "close_technique", label: "Close Technique" },
];

const FAKE_PRODUCTS = [
    "AI-powered ergonomic standing desk",
    "smart blue-light blocking glasses",
    "voice-controlled task manager app",
    "portable cold brew maker",
    "noise-canceling focus earbuds",
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function buildSystemPrompt(playbook: Playbook, product: string): string {
    return `You are a professional sales representative conducting a phone call with a potential customer. You sell an AI-powered business analytics platform that helps companies make better data-driven decisions.
CURRENT SALES STRATEGY:
${playbook.strategy}
YOUR OPENING APPROACH:
${playbook.opener}
HOW TO HANDLE OBJECTIONS:
${playbook.objection_style}
YOUR VOCAL TONE AND ENERGY:
${playbook.tone}
HOW TO CLOSE THE DEAL:
${playbook.close_technique}
RULES:
Follow the strategy, tone, and techniques above precisely. They are your playbook.
Be conversational and natural — you are on a voice call, not writing an email.
Keep responses concise (1-3 sentences max). This is a real-time conversation, not a monologue.
Listen actively. When the prospect speaks, acknowledge what they said before responding.
Ask open-ended questions to understand the prospect's needs and pain points.
If the prospect raises an objection, use the objection handling style above.
When you sense interest and the timing is right, use the closing technique above.
Never be pushy or aggressive. If the prospect wants to end the call, wrap up gracefully.
Track the conversation outcome mentally: did they convert, ask for a callback, decline, or hang up?
If asked about pricing, the platform starts at $499/month for small teams and scales based on usage.
PRODUCT DETAILS (use when relevant):
AI-powered dashboards that surface insights automatically
Integrates with Salesforce, HubSpot, Slack, and 50+ tools
Saves teams an average of 10 hours per week on reporting
14-day free trial, no credit card required
Used by 500+ companies including mid-market and enterprise
CURRENT PRODUCT TO SELL:
${product}`;
}

async function persistTranscriptWithRetry(conversationId: string) {
    // ElevenLabs can take a few seconds to finalize conversation transcript data.
    const retryDelaysMs = [0, 1500, 3000, 6000, 10000];

    for (let i = 0; i < retryDelaysMs.length; i += 1) {
        if (retryDelaysMs[i] > 0) {
            await sleep(retryDelaysMs[i]);
        }

        try {
            const res = await fetch("/api/calls/save-transcript", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ conversation_id: conversationId }),
            });

            const json = await res.json().catch(() => ({}));
            if (res.ok && json?.ok === true) {
                return;
            }

            if (json?.pending !== true) {
                console.error("[save-transcript] unexpected response", {
                    status: res.status,
                    body: json,
                });
                return;
            }
        } catch (err) {
            console.error("[save-transcript] request failed", err);
        }
    }

    console.warn("[save-transcript] transcript still pending after retries", {
        conversationId,
    });
}

export function AgentConsole({ initialPlaybooks, initialSummary }: Props) {
    const [isStarting, setIsStarting] = useState(false);
    const [playbooks, setPlaybooks] = useState<Playbook[]>(initialPlaybooks);
    const [summary, setSummary] = useState(initialSummary);
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [callError, setCallError] = useState<string | null>(null);
    const [lastSyncLabel, setLastSyncLabel] = useState("pending");
    // Ref so the onDisconnect closure always has the current conversation ID
    const conversationIdRef = useRef<string | null>(null);

    const activePlaybook = useMemo(
        () =>
            playbooks.reduce(
                (top, p) => (p.version > top.version ? p : top),
                playbooks[0],
            ),
        [playbooks],
    );
    const [selectedPlaybookId, setSelectedPlaybookId] = useState(
        initialPlaybooks[0]?.id ?? "",
    );
    const selectedPlaybook =
        playbooks.find((p) => p.id === selectedPlaybookId) ?? activePlaybook;
    const selectedPlaybookIndex = Math.max(
        0,
        playbooks.findIndex((p) => p.id === selectedPlaybook.id),
    );

    const canGoNewer = selectedPlaybookIndex > 0;
    const canGoOlder = selectedPlaybookIndex < playbooks.length - 1;

    const formatUtc = (iso: string) =>
        new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";

    const refreshData = useCallback(async () => {
        try {
            const [playbooksRes, summaryRes] = await Promise.all([
                fetch("/api/playbooks"),
                fetch("/api/calls/summary"),
            ]);
            const playbooksJson = await playbooksRes.json();
            const summaryJson = await summaryRes.json();

            if (playbooksRes.ok && Array.isArray(playbooksJson.playbooks)) {
                setPlaybooks(playbooksJson.playbooks);
                const selectedStillExists = playbooksJson.playbooks.some(
                    (p: Playbook) => p.id === selectedPlaybookId,
                );
                if (!selectedStillExists && playbooksJson.playbooks[0]) {
                    setSelectedPlaybookId(playbooksJson.playbooks[0].id);
                }
            }

            if (summaryRes.ok) {
                setSummary({
                    totalCalls: summaryJson.total_calls ?? 0,
                    analyzedCalls: summaryJson.analyzed_calls ?? 0,
                    latestCall: summaryJson.latest_call
                        ? {
                              id: summaryJson.latest_call.id,
                              conversationId:
                                  summaryJson.latest_call.conversation_id,
                              createdAt: summaryJson.latest_call.created_at,
                              transcriptPreview:
                                  summaryJson.latest_call.transcript_preview ??
                                  "",
                              hasAnalysis: Boolean(
                                  summaryJson.latest_call.has_analysis,
                              ),
                          }
                        : null,
                });
            }
            setLastSyncLabel(
                new Date().toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                }),
            );
        } catch (err) {
            console.error("[dashboard-refresh]", err);
        }
    }, [selectedPlaybookId]);

    useEffect(() => {
        setLastSyncLabel(
            new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
            }),
        );
        const timer = setInterval(() => {
            refreshData().catch((err) =>
                console.error("[dashboard-refresh]", err),
            );
        }, 8000);
        return () => clearInterval(timer);
    }, [refreshData]);

    const conversation = useConversation({
        onConnect: () => {
            setIsStarting(false);
            setCallError(null);
        },
        onDisconnect: (details) => {
            const d = (details ?? {}) as Partial<{
                reason: "error" | "agent" | "user";
                closeCode: number;
                closeReason: string;
                message: string;
            }>;
            const endedId = conversationIdRef.current;
            setSummary((prev) => ({
                ...prev,
                totalCalls: prev.totalCalls + 1,
            }));
            setConversationId(null);
            conversationIdRef.current = null;
            if (d.reason === "error") {
                console.warn("[ElevenLabs disconnect:error]", d);
                setCallError(
                    `Call ended (error${d.closeCode ? ` ${d.closeCode}` : ""})${
                        d.closeReason
                            ? `: ${d.closeReason}`
                            : d.message
                              ? `: ${d.message}`
                              : ""
                    }`,
                );
            } else if (d.reason === "agent") {
                setCallError("Call ended by agent.");
            } else if (d.reason === "user") {
                // Expected when user hangs up.
                setCallError(null);
            } else {
                // Some SDK disconnect callbacks can arrive without structured details.
                console.info("[ElevenLabs disconnect:unknown]", d);
                setCallError("Call ended.");
            }

            if (endedId) {
                persistTranscriptWithRetry(endedId).catch((err) =>
                    console.error("[save-transcript]", err),
                );
            }

            refreshData().catch((err) =>
                console.error("[dashboard-refresh]", err),
            );
        },
        onError: (msg) => {
            console.error("[ElevenLabs]", msg);
            setIsStarting(false);
            setCallError(typeof msg === "string" ? msg : "Connection error");
        },
    });

    const handleStartCall = useCallback(async () => {
        setIsStarting(true);
        setCallError(null);
        try {
            await navigator.mediaDevices.getUserMedia({ audio: true });

            const res = await fetch("/api/elevenlabs/signed-url");
            const json = await res.json();
            if (json.error) throw new Error(json.error);

            const pickedProduct =
                FAKE_PRODUCTS[Math.floor(Math.random() * FAKE_PRODUCTS.length)];
            let livePlaybook = playbook;
            const latestRes = await fetch("/api/playbooks/latest");
            if (latestRes.ok) {
                const latest = (await latestRes.json()) as Partial<Playbook>;
                if (
                    latest?.strategy &&
                    latest?.opener &&
                    latest?.objection_style &&
                    latest?.tone &&
                    latest?.close_technique
                ) {
                    livePlaybook = { ...playbook, ...latest };
                }
            }
            const systemPrompt = buildSystemPrompt(livePlaybook, pickedProduct);

            const sessionBase = {
                signedUrl: json.signed_url,
                dynamicVariables: {
                    playbook_strategy: livePlaybook.strategy,
                    opener: livePlaybook.opener,
                    objection_style: livePlaybook.objection_style,
                    tone: livePlaybook.tone,
                    close_technique: livePlaybook.close_technique,
                    product_name: pickedProduct,
                    fake_product: pickedProduct,
                },
            };

            let id: string;
            try {
                id = await conversation.startSession({
                    ...sessionBase,
                    overrides: { agent: { prompt: { prompt: systemPrompt } } },
                });
            } catch (err) {
                const message =
                    err instanceof Error ? err.message : String(err);
                if (
                    message.includes(
                        "Override for field 'agent.prompt.prompt' is not allowed by config",
                    )
                ) {
                    id = await conversation.startSession(sessionBase);
                } else {
                    throw err;
                }
            }
            setConversationId(id);
            conversationIdRef.current = id;
            // Some agent configs don't allow first_message overrides and may wait for user speech.
            // Send a lightweight opener input so the agent immediately takes the first audible turn.
            conversation.sendUserMessage("hello");
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setCallError(msg);
            setIsStarting(false);
        }
    }, [conversation, activePlaybook]);

    const handleEndCall = useCallback(async () => {
        await conversation.endSession();
    }, [conversation]);

    const isConnected = conversation.status === "connected";
    const isConnecting = isStarting || conversation.status === "connecting";
    const isSpeaking = isConnected && conversation.isSpeaking;

    const analysisPct =
        summary.totalCalls > 0
            ? Math.round((summary.analyzedCalls / summary.totalCalls) * 100)
            : 0;

    return (
        <div
            className="min-h-screen bg-[#07070f] text-slate-100 flex flex-col"
            style={{ fontFamily: "var(--font-syne), system-ui, sans-serif" }}
        >
            {/* ── Header ── */}
            <header className="border-b border-[#1a1a28] px-6 py-4 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                    <span
                        className="text-xs tracking-[0.22em] uppercase text-slate-500"
                        style={{ fontFamily: "var(--font-mono)" }}
                    >
                        Sales Agent
                    </span>
                    <span className="text-[9px] bg-lime-400/10 text-lime-400 border border-lime-400/20 px-2 py-0.5 rounded tracking-[0.18em] uppercase">
                        Self-Improving
                    </span>
                </div>

                <div className="flex items-center gap-5">
                    <span
                        className="text-xs text-amber-400"
                        style={{ fontFamily: "var(--font-mono)" }}
                    >
                        PLAYBOOK v{activePlaybook.version}
                    </span>

                    <div
                        className={`flex items-center gap-1.5 text-xs ${
                            isConnected
                                ? "text-lime-400"
                                : isConnecting
                                  ? "text-amber-400"
                                  : "text-slate-600"
                        }`}
                        style={{ fontFamily: "var(--font-mono)" }}
                    >
                        <div
                            className={`w-1.5 h-1.5 rounded-full ${
                                isConnected
                                    ? "bg-lime-400 shadow-[0_0_6px_#a3e635]"
                                    : isConnecting
                                      ? "bg-amber-400"
                                      : "bg-slate-700"
                            }`}
                        />
                        {isConnecting
                            ? "CONNECTING..."
                            : isConnected
                              ? isSpeaking
                                  ? "AGENT SPEAKING"
                                  : "LISTENING"
                              : "READY"}
                    </div>
                </div>
            </header>

            {/* ── Main 3-column grid ── */}
            <main className="flex-1 grid grid-cols-[1fr_300px_1fr] min-h-0">
                {/* ── Left: Playbook Evolution ── */}
                <div className="border-r border-[#1a1a28] p-6 overflow-y-auto">
                    <h2
                        className="text-[9px] tracking-[0.28em] uppercase text-slate-600 mb-5"
                        style={{ fontFamily: "var(--font-mono)" }}
                    >
                        Playbook Evolution
                    </h2>

                    <div className="mb-5 rounded-md border border-[#1a1a28] p-3 bg-[#0b0b14]">
                        <p
                            className="text-[10px] text-slate-500 mb-2"
                            style={{ fontFamily: "var(--font-mono)" }}
                        >
                            Versions ({playbooks.length})
                        </p>
                        <div className="rounded-md border border-[#2a2a3a] bg-[#080811] p-3">
                            <div className="flex items-center justify-between mb-3">
                                <button
                                    type="button"
                                    onClick={() =>
                                        canGoNewer &&
                                        setSelectedPlaybookId(
                                            playbooks[selectedPlaybookIndex - 1]
                                                .id,
                                        )
                                    }
                                    disabled={!canGoNewer}
                                    className="w-8 h-8 rounded-full border border-[#2a2a3a] text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:border-lime-400/50"
                                    aria-label="Show newer playbook"
                                >
                                    ←
                                </button>
                                <div className="text-center">
                                    <p className="text-lg text-slate-100">
                                        v{selectedPlaybook.version}
                                    </p>
                                    <p
                                        className="text-[10px] text-slate-500"
                                        style={{
                                            fontFamily: "var(--font-mono)",
                                        }}
                                    >
                                        {selectedPlaybookIndex + 1} /{" "}
                                        {playbooks.length} (newest → oldest)
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() =>
                                        canGoOlder &&
                                        setSelectedPlaybookId(
                                            playbooks[selectedPlaybookIndex + 1]
                                                .id,
                                        )
                                    }
                                    disabled={!canGoOlder}
                                    className="w-8 h-8 rounded-full border border-[#2a2a3a] text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:border-lime-400/50"
                                    aria-label="Show older playbook"
                                >
                                    →
                                </button>
                            </div>
                            <p
                                className="text-[10px] text-slate-500"
                                style={{ fontFamily: "var(--font-mono)" }}
                            >
                                Created {formatUtc(selectedPlaybook.created_at)}
                            </p>
                        </div>
                    </div>

                    <div className="space-y-3">
                        {PLAYBOOK_FIELDS.map(({ key, label }) => (
                            <div
                                key={key}
                                className="border border-[#1a1a28] rounded-md p-3 hover:border-[#2a2a3a] transition-colors"
                            >
                                <div
                                    className="text-[9px] tracking-[0.22em] uppercase text-slate-600 mb-1"
                                    style={{ fontFamily: "var(--font-mono)" }}
                                >
                                    {label}
                                </div>
                                <p className="text-sm text-slate-300 leading-relaxed">
                                    {selectedPlaybook[key] as string}
                                </p>
                            </div>
                        ))}
                    </div>

                    {selectedPlaybook.rationale && (
                        <div className="mt-4 pt-4 border-t border-[#1a1a28]">
                            <div
                                className="text-[9px] tracking-[0.22em] uppercase text-slate-600 mb-1.5"
                                style={{ fontFamily: "var(--font-mono)" }}
                            >
                                Rationale
                            </div>
                            <p className="text-xs text-slate-500 leading-relaxed">
                                {selectedPlaybook.rationale}
                            </p>
                        </div>
                    )}
                </div>

                {/* ── Center: Call Interface ── */}
                <div className="flex flex-col items-center justify-center gap-7 px-6 py-12 border-r border-[#1a1a28]">
                    {/* Call button */}
                    <div className="relative flex items-center justify-center">
                        {/* Idle pulse ring */}
                        {!isConnected && !isConnecting && (
                            <div className="absolute w-36 h-36 rounded-full border border-lime-400/20 animate-pulse-ring pointer-events-none" />
                        )}

                        <button
                            onClick={
                                isConnected
                                    ? handleEndCall
                                    : isConnecting
                                      ? undefined
                                      : handleStartCall
                            }
                            disabled={isConnecting}
                            aria-label={isConnected ? "End call" : "Start call"}
                            className={`
                relative w-28 h-28 rounded-full flex items-center justify-center
                transition-all duration-300 select-none
                ${
                    isConnected
                        ? "bg-lime-400 hover:bg-lime-300 cursor-pointer shadow-[0_0_36px_rgba(163,230,53,0.35)]"
                        : isConnecting
                          ? "bg-[#0f0f1a] border-2 border-amber-400/50 cursor-not-allowed"
                          : "bg-[#0f0f1a] border border-[#2a2a3a] cursor-pointer hover:border-lime-400/30 hover:shadow-[0_0_24px_rgba(163,230,53,0.12)]"
                }
              `}
                        >
                            {isConnecting ? (
                                <div className="w-8 h-8 rounded-full border-2 border-amber-400/20 border-t-amber-400 animate-spin" />
                            ) : isConnected ? (
                                /* End call X */
                                <svg
                                    className="w-8 h-8 text-black"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2.5}
                                        d="M6 18L18 6M6 6l12 12"
                                    />
                                </svg>
                            ) : (
                                /* Phone icon */
                                <svg
                                    className="w-8 h-8 text-lime-400"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={1.75}
                                        d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                                    />
                                </svg>
                            )}
                        </button>
                    </div>

                    {/* Speaking / status indicator */}
                    <div className="h-8 flex items-center justify-center">
                        {isSpeaking ? (
                            <SoundBars />
                        ) : isConnected ? (
                            <div className="flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-lime-400 animate-pulse" />
                                <span
                                    className="text-[10px] text-lime-400 tracking-[0.2em] uppercase"
                                    style={{ fontFamily: "var(--font-mono)" }}
                                >
                                    Listening
                                </span>
                            </div>
                        ) : (
                            <span
                                className="text-[10px] text-slate-600 tracking-[0.2em] uppercase"
                                style={{ fontFamily: "var(--font-mono)" }}
                            >
                                {isConnecting
                                    ? "Setting up..."
                                    : "Tap to start"}
                            </span>
                        )}
                    </div>

                    {/* Error */}
                    {callError && (
                        <div className="text-xs text-rose-400 text-center px-4 leading-relaxed max-w-[220px]">
                            {callError}
                        </div>
                    )}

                    {/* Conversation ID */}
                    {conversationId && (
                        <div
                            className="text-[9px] text-slate-700 text-center"
                            style={{ fontFamily: "var(--font-mono)" }}
                        >
                            {conversationId.slice(0, 24)}…
                        </div>
                    )}
                </div>

                {/* ── Right: Improvement Engine ── */}
                <div className="p-6 overflow-y-auto">
                    <h2
                        className="text-[9px] tracking-[0.28em] uppercase text-slate-600 mb-5"
                        style={{ fontFamily: "var(--font-mono)" }}
                    >
                        Learning Engine
                    </h2>

                    <div className="border border-[#1a1a28] rounded-md p-4 mb-4">
                        <div className="flex items-baseline justify-between mb-2">
                            <span
                                className="text-[9px] uppercase tracking-widest text-slate-600"
                                style={{ fontFamily: "var(--font-mono)" }}
                            >
                                Calls Processed
                            </span>
                            <span
                                className="text-sm text-amber-400"
                                style={{ fontFamily: "var(--font-mono)" }}
                            >
                                {summary.totalCalls}
                                <span className="text-slate-600"> total</span>
                            </span>
                        </div>

                        <div className="w-full h-1 bg-[#1a1a28] rounded-full overflow-hidden">
                            <div
                                className="h-full bg-amber-400 rounded-full transition-all duration-500"
                                style={{ width: `${analysisPct}%` }}
                            />
                        </div>

                        <p className="text-xs text-slate-500 mt-2.5">
                            {summary.analyzedCalls} analyzed ({analysisPct}%
                            coverage)
                        </p>
                    </div>

                    <div className="space-y-3">
                        <div className="border border-[#1a1a28] rounded-md p-4">
                            <div
                                className="text-[9px] tracking-[0.22em] uppercase text-slate-600 mb-2"
                                style={{ fontFamily: "var(--font-mono)" }}
                            >
                                Latest Rewrite
                            </div>
                            <p className="text-sm text-lime-300 mb-1">
                                v{activePlaybook.version}
                            </p>
                            <p className="text-xs text-slate-500">
                                {formatUtc(activePlaybook.created_at)}
                            </p>
                        </div>

                        <div className="border border-[#1a1a28] rounded-md p-4">
                            <div
                                className="text-[9px] tracking-[0.22em] uppercase text-slate-600 mb-2"
                                style={{ fontFamily: "var(--font-mono)" }}
                            >
                                Latest Call
                            </div>
                            {summary.latestCall ? (
                                <>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span
                                            className="text-[9px] text-slate-500"
                                            style={{
                                                fontFamily: "var(--font-mono)",
                                            }}
                                        >
                                            {formatUtc(
                                                summary.latestCall.createdAt,
                                            )}
                                        </span>
                                        <span
                                            className={`text-[10px] px-2 py-1 rounded border ${
                                                summary.latestCall.hasAnalysis
                                                    ? "text-lime-300 border-lime-400/30 bg-lime-400/10"
                                                    : "text-amber-300 border-amber-400/30 bg-amber-400/10"
                                            }`}
                                        >
                                            {summary.latestCall.hasAnalysis
                                                ? "Analyzed"
                                                : "Pending Analysis"}
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-400 leading-relaxed line-clamp-4">
                                        {summary.latestCall.transcriptPreview ||
                                            "No transcript preview yet."}
                                    </p>
                                </>
                            ) : (
                                <p className="text-xs text-slate-500">
                                    No calls yet.
                                </p>
                            )}
                        </div>

                        <p
                            className="text-[10px] text-slate-600"
                            style={{ fontFamily: "var(--font-mono)" }}
                        >
                            Auto-sync every 8s · Last sync {lastSyncLabel}
                        </p>
                    </div>
                </div>
            </main>

            {/* ── Footer ── */}
            <footer className="border-t border-[#1a1a28] px-6 py-3 flex items-center justify-between shrink-0">
                <span
                    className="text-[9px] text-slate-700 tracking-widest uppercase"
                    style={{ fontFamily: "var(--font-mono)" }}
                >
                    Modulate Velma · Airia · ElevenLabs
                </span>
                <span
                    className="text-[9px] text-slate-700"
                    style={{ fontFamily: "var(--font-mono)" }}
                >
                    {new Date().toLocaleDateString()}
                </span>
            </footer>
        </div>
    );
}
