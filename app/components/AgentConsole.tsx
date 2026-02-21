"use client";

import { useConversation } from "@elevenlabs/react";
import { useState, useCallback, useRef } from "react";

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
  playbook: Playbook;
  callsSinceLast: number;
  batchSize: number;
  improvementLogs: ImprovementLog[];
};

function SoundBars() {
  return (
    <div className="flex items-end gap-[3px] h-6">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className={`w-[3px] bg-lime-400 rounded-full bar-${i}`} />
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

export function AgentConsole({
  playbook,
  callsSinceLast,
  batchSize,
  improvementLogs,
}: Props) {
  const [isStarting, setIsStarting] = useState(false);
  const [callCount, setCallCount] = useState(callsSinceLast);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  // Ref so the onDisconnect closure always has the current conversation ID
  const conversationIdRef = useRef<string | null>(null);

  const conversation = useConversation({
    onConnect: () => {
      setIsStarting(false);
      setCallError(null);
    },
    onDisconnect: () => {
      const endedId = conversationIdRef.current;
      setCallCount((prev) => prev + 1);
      setConversationId(null);
      conversationIdRef.current = null;

      if (endedId) {
        persistTranscriptWithRetry(endedId).catch((err) =>
          console.error("[save-transcript]", err)
        );
      }
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

      const id = await conversation.startSession({
        signedUrl: json.signed_url,
        dynamicVariables: {
          playbook_strategy: playbook.strategy,
          opener: playbook.opener,
          objection_style: playbook.objection_style,
          tone: playbook.tone,
          close_technique: playbook.close_technique,
        },
      });
      setConversationId(id);
      conversationIdRef.current = id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setCallError(msg);
      setIsStarting(false);
    }
  }, [conversation, playbook]);

  const handleEndCall = useCallback(async () => {
    await conversation.endSession();
  }, [conversation]);

  const isConnected = conversation.status === "connected";
  const isConnecting = isStarting || conversation.status === "connecting";
  const isSpeaking = isConnected && conversation.isSpeaking;

  const callsUntilNext = Math.max(0, batchSize - callCount);
  const progressPct = Math.min(100, (callCount / batchSize) * 100);

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
            PLAYBOOK v{playbook.version}
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
        {/* ── Left: Active Playbook ── */}
        <div className="border-r border-[#1a1a28] p-6 overflow-y-auto">
          <h2
            className="text-[9px] tracking-[0.28em] uppercase text-slate-600 mb-5"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Active Playbook
          </h2>

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
                  {playbook[key] as string}
                </p>
              </div>
            ))}
          </div>

          {playbook.rationale && (
            <div className="mt-4 pt-4 border-t border-[#1a1a28]">
              <div
                className="text-[9px] tracking-[0.22em] uppercase text-slate-600 mb-1.5"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                Rationale
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                {playbook.rationale}
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
                {isConnecting ? "Setting up..." : "Tap to start"}
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
            Improvement Engine
          </h2>

          {/* Cycle progress */}
          <div className="border border-[#1a1a28] rounded-md p-4 mb-4">
            <div className="flex items-baseline justify-between mb-2">
              <span
                className="text-[9px] uppercase tracking-widest text-slate-600"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                This Cycle
              </span>
              <span
                className="text-sm text-amber-400"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {callCount}
                <span className="text-slate-600">/{batchSize}</span>
              </span>
            </div>

            <div className="w-full h-1 bg-[#1a1a28] rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-400 rounded-full transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>

            <p className="text-xs text-slate-500 mt-2.5">
              {callsUntilNext === 0
                ? "Rewrite triggered — Airia is running…"
                : `${callsUntilNext} call${callsUntilNext !== 1 ? "s" : ""} until next playbook rewrite`}
            </p>
          </div>

          {/* Improvement history */}
          {improvementLogs.length > 0 ? (
            <div className="space-y-3">
              <div
                className="text-[9px] tracking-[0.22em] uppercase text-slate-600"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                History
              </div>
              {improvementLogs.map((log) => (
                <div
                  key={log.id}
                  className="border border-[#1a1a28] rounded-md p-3 hover:border-[#2a2a3a] transition-colors"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span
                      className="text-[9px] text-slate-600"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {new Date(log.created_at).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span
                      className="text-[9px] text-amber-400"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {log.calls_analyzed} calls
                    </span>
                  </div>
                  {log.analysis_summary && (
                    <p className="text-xs text-slate-400 leading-relaxed line-clamp-3">
                      {log.analysis_summary}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="border border-[#1a1a28] rounded-md p-5 text-center">
              <p className="text-xs text-slate-600 leading-relaxed">
                No improvements yet.
                <br />
                Complete {batchSize} calls to trigger
                <br />
                the first Airia rewrite.
              </p>
            </div>
          )}
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
