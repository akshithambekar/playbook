import { createClient } from "@/lib/supabase/server";
import { analyzeCall } from "@/lib/velma/analyze";
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

async function runAudioAnalysisFromConversation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  conversationId: string,
  callId: string
) {
  const elevenlabsKey = process.env.ELEVENLABS_API_KEY;
  if (!elevenlabsKey) return;

  const audioRes = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversations/${conversationId}/audio`,
    { headers: { "xi-api-key": elevenlabsKey } }
  );

  if (!audioRes.ok) {
    const detail = await audioRes.text();
    throw new Error(`Could not fetch conversation audio (${audioRes.status}): ${detail}`);
  }

  const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
  if (!audioBuffer.length) {
    throw new Error("Fetched empty audio payload");
  }

  const analysis = await analyzeCall(audioBuffer, `${conversationId}.mp3`);
  const { error } = await supabase
    .from("call_analysis")
    .upsert({ call_id: callId, ...analysis }, { onConflict: "call_id" });

  if (error) {
    throw new Error(error.message);
  }
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

  let callId: string;

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
    callId = existingCall.id;
  } else {
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
    callId = data.id;
  }

  // Fast reliability hotfix: if ElevenLabs audio webhook is flaky, pull audio directly
  // from Conversation API when transcript webhook arrives.
  try {
    await runAudioAnalysisFromConversation(supabase, conversationId, callId);
  } catch (err) {
    console.error("[webhook/transcript] audio analysis fallback failed:", err);
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  fetch(`${baseUrl}/api/trigger-improvement`, { method: "POST" }).catch((e) =>
    console.error("[webhook/transcript] trigger-improvement error:", e)
  );

  return NextResponse.json({ ok: true, call_id: callId });
}
