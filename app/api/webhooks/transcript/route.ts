import { createClient } from "@/lib/supabase/server";
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

export async function POST(request: Request) {
  const supabase = await createClient();
  const body = (await request.json()) as ElevenLabsTranscriptWebhook;
  const { conversationId, transcript, outcome, mainObjection, interestLevel } =
    normalizeWebhookPayload(body);

  if (!conversationId) {
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
  const { data: latestPlaybook } = await supabase
    .from("playbooks")
    .select("id")
    .order("version", { ascending: false })
    .limit(1)
    .single();

  const { data: existingCall } = await supabase
    .from("calls")
    .select("id")
    .eq("elevenlabs_conversation_id", conversationId)
    .maybeSingle();

  if (existingCall) {
    const updatePayload: Record<string, unknown> = {
      outcome: outcome as
        | "converted"
        | "no_close"
        | "callback"
        | "hung_up"
        | null,
      main_objection: mainObjection,
      interest_level: interestLevel,
    };
    if (latestPlaybook?.id) updatePayload.playbook_id = latestPlaybook.id;
    if (transcript != null && transcript.trim() !== "") {
      updatePayload.transcript = transcript;
    }

    const { error } = await supabase
      .from("calls")
      .update(updatePayload)
      .eq("id", existingCall.id);

    if (error) {
      console.error("[webhook/transcript] DB error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, call_id: existingCall.id });
  }

  const { data, error } = await supabase
    .from("calls")
    .insert({
      elevenlabs_conversation_id: conversationId,
      transcript: transcript,
      outcome: outcome as
        | "converted"
        | "no_close"
        | "callback"
        | "hung_up"
        | null,
      main_objection: mainObjection,
      interest_level: interestLevel,
      playbook_id: latestPlaybook?.id ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error("[webhook/transcript] DB error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, call_id: data.id });
}
