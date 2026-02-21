import db from "@/lib/db";
import { NextResponse } from "next/server";

// ElevenLabs post-call transcript webhook payload
type ElevenLabsTranscriptWebhook = {
  conversation_id?: string;
  conversationId?: string;
  status?: string;
  transcript?: unknown;
  event_type?: string;
  eventType?: string;
  event?: {
    type?: string;
    data?: {
      conversation_id?: string;
      transcript?: unknown;
      data_collection_results?: {
        outcome?: { value?: string };
        main_objection?: { value?: string };
        interest_level?: { value?: string };
      };
    };
  };
  data?: {
    conversation_id?: string;
    transcript?: unknown;
    data_collection_results?: {
      outcome?: { value?: string };
      main_objection?: { value?: string };
      interest_level?: { value?: string };
    };
  };
  data_collection_results?: {
    outcome?: { value?: string };
    main_objection?: { value?: string };
    interest_level?: { value?: string };
  };
  metadata?: {
    agent_id?: string;
  };
};

function coerceTranscript(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;

  if (Array.isArray(value)) {
    const lines = value
      .map((turn) => {
        if (typeof turn !== "object" || turn == null) return null;
        const role = "role" in turn ? String((turn as { role?: unknown }).role ?? "") : "";
        const message =
          "message" in turn ? String((turn as { message?: unknown }).message ?? "") : "";
        if (!role && !message) return null;
        return `${role || "unknown"}: ${message}`;
      })
      .filter((line): line is string => Boolean(line));

    const text = lines.join("\n").trim();
    return text.length > 0 ? text : null;
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function normalizeWebhookPayload(body: ElevenLabsTranscriptWebhook) {
  const conversationId =
    body.conversation_id ??
    body.conversationId ??
    body.data?.conversation_id ??
    body.event?.data?.conversation_id ??
    null;

  const transcriptRaw =
    body.transcript ??
    body.data?.transcript ??
    body.event?.data?.transcript ??
    null;
  const transcript = coerceTranscript(transcriptRaw);

  const dataCollection =
    body.data_collection_results ??
    body.data?.data_collection_results ??
    body.event?.data?.data_collection_results ??
    null;

  const outcome = dataCollection?.outcome?.value ?? null;
  const mainObjection = dataCollection?.main_objection?.value ?? null;
  const interestLevel = dataCollection?.interest_level?.value ?? null;

  return { conversationId, transcript, outcome, mainObjection, interestLevel };
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "POST /api/webhooks/transcript" });
}

export async function POST(request: Request) {
  const body = (await request.json()) as ElevenLabsTranscriptWebhook;
  const { conversationId, transcript, outcome, mainObjection, interestLevel } =
    normalizeWebhookPayload(body);

  if (!conversationId) {
    // Some webhook providers send setup or validation events without conversation data.
    // Returning 202 avoids false-negative retries while giving us debug context.
    console.warn("[webhook/transcript] Ignored payload without conversation_id", {
      topLevelKeys: Object.keys(body ?? {}),
      eventType: body.event_type ?? body.eventType ?? body.event?.type ?? null,
    });
    return NextResponse.json(
      { ok: false, ignored: true, reason: "Missing conversation_id" },
      { status: 202 }
    );
  }

  // Get the latest playbook version to associate with this call
  const latestPlaybook = db
    .prepare(`SELECT id FROM playbooks ORDER BY version DESC LIMIT 1`)
    .get() as { id: string } | undefined;

  try {
    // Check if a row already exists (audio webhook may have fired first)
    const existing = db
      .prepare(
        `SELECT id FROM calls WHERE elevenlabs_conversation_id = ?`
      )
      .get(conversationId) as { id: string } | undefined;

    let callId: string;

    if (existing) {
      // Update the existing row with transcript data
      db.prepare(
        `UPDATE calls
         SET transcript = ?,
             outcome = ?,
             main_objection = ?,
             interest_level = ?,
             playbook_id = COALESCE(playbook_id, ?)
         WHERE elevenlabs_conversation_id = ?`
      ).run(
        transcript,
        outcome,
        mainObjection,
        interestLevel,
        latestPlaybook?.id ?? null,
        conversationId
      );
      callId = existing.id;
    } else {
      callId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO calls
           (id, elevenlabs_conversation_id, transcript, outcome, main_objection, interest_level, playbook_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        callId,
        conversationId,
        transcript,
        outcome,
        mainObjection,
        interestLevel,
        latestPlaybook?.id ?? null,
        new Date().toISOString()
      );
    }

    return NextResponse.json({ ok: true, call_id: callId });
  } catch (err) {
    console.error("[webhook/transcript] DB error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
