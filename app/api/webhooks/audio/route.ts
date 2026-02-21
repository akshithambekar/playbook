import { createClient } from "@/lib/supabase/server";
import { analyzeCall } from "@/lib/velma/analyze";
import { NextResponse } from "next/server";

type ElevenLabsAudioWebhook = {
  conversation_id?: string;
  conversationId?: string;
  audio?: string;
  audio_base64?: string;
  audio_base_64?: string;
  audioBase64?: string;
  audio_url?: string;
  recording_url?: string;
  event?: {
    type?: string;
    data?: {
      conversation_id?: string;
      conversationId?: string;
      audio?: string;
      audio_base64?: string;
      audio_base_64?: string;
      audioBase64?: string;
      audio_url?: string;
      recording_url?: string;
    };
  };
  data?: {
    conversation_id?: string;
    conversationId?: string;
    audio?: string;
    audio_base64?: string;
    audio_base_64?: string;
    audioBase64?: string;
    audio_url?: string;
    recording_url?: string;
  };
};

function getNestedPayload(body: ElevenLabsAudioWebhook) {
  return body.data ?? body.event?.data ?? null;
}

function getConversationId(body: ElevenLabsAudioWebhook): string | null {
  const nested = getNestedPayload(body);
  return (
    body.conversation_id ??
    body.conversationId ??
    nested?.conversation_id ??
    nested?.conversationId ??
    null
  );
}

function getAudioBase64(body: ElevenLabsAudioWebhook): string | null {
  const nested = getNestedPayload(body);
  return (
    body.audio ??
    body.audio_base64 ??
    body.audio_base_64 ??
    body.audioBase64 ??
    nested?.audio ??
    nested?.audio_base64 ??
    nested?.audio_base_64 ??
    nested?.audioBase64 ??
    null
  );
}

function getAudioUrl(body: ElevenLabsAudioWebhook): string | null {
  const nested = getNestedPayload(body);
  return body.audio_url ?? body.recording_url ?? nested?.audio_url ?? nested?.recording_url ?? null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const body: ElevenLabsAudioWebhook = await request.json();

  const conversationId = getConversationId(body);
  if (!conversationId) {
    console.warn("[webhook/audio] Ignored payload without conversation_id", {
      topLevelKeys: Object.keys(body ?? {}),
      eventType: body.event?.type ?? null,
    });
    return NextResponse.json(
      { ok: false, ignored: true, reason: "Missing conversation_id" },
      { status: 202 }
    );
  }

  let audioBuffer: Buffer | null = null;
  const b64Audio = getAudioBase64(body);
  if (b64Audio) {
    audioBuffer = Buffer.from(b64Audio, "base64");
  }

  // Some providers deliver audio by URL instead of inline base64.
  if (!audioBuffer) {
    const audioUrl = getAudioUrl(body);
    if (audioUrl) {
      const audioRes = await fetch(audioUrl);
      if (!audioRes.ok) {
        const detail = await audioRes.text();
        console.error("[webhook/audio] Failed to fetch audio URL:", audioRes.status, detail);
        return NextResponse.json(
          { error: "Failed to fetch audio URL", detail },
          { status: 502 }
        );
      }
      const bytes = await audioRes.arrayBuffer();
      audioBuffer = Buffer.from(bytes);
    }
  }

  if (!audioBuffer) {
    console.warn("[webhook/audio] Ignored payload without audio data", {
      conversationId,
      topLevelKeys: Object.keys(body ?? {}),
      eventType: body.event?.type ?? null,
    });
    return NextResponse.json(
      { ok: false, ignored: true, reason: "Missing audio payload" },
      { status: 202 }
    );
  }

  // Look up the call row by conversation_id
  const { data: existingCall, error: callError } = await supabase
    .from("calls")
    .select("id")
    .eq("elevenlabs_conversation_id", conversationId)
    .single();

  let callId: string;

  if (callError || !existingCall) {
    // Transcript webhook may not have fired yet — upsert a minimal calls row
    const { data: upserted, error: upsertError } = await supabase
      .from("calls")
      .upsert(
        { elevenlabs_conversation_id: conversationId },
        { onConflict: "elevenlabs_conversation_id" }
      )
      .select("id")
      .single();

    if (upsertError || !upserted) {
      return NextResponse.json(
        { error: "Could not resolve call row" },
        { status: 500 }
      );
    }
    callId = upserted.id;
  } else {
    callId = existingCall.id;
  }

  // Run Velma analysis
  let analysis;
  try {
    analysis = await analyzeCall(audioBuffer, `${conversationId}.mp3`);
  } catch (err) {
    console.error("[webhook/audio] Velma error:", err);
    return NextResponse.json(
      { error: "Velma analysis failed", detail: String(err) },
      { status: 502 }
    );
  }

  // Upsert into call_analysis (idempotent if audio webhook fires twice)
  const { error: insertError } = await supabase
    .from("call_analysis")
    .upsert(
      { call_id: callId, ...analysis },
      { onConflict: "call_id" }
    );

  if (insertError) {
    console.error("[webhook/audio] DB error:", insertError);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Fire improvement check asynchronously — don't block the webhook response
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  fetch(`${baseUrl}/api/trigger-improvement`, { method: "POST" }).catch((e) =>
    console.error("[webhook/audio] trigger-improvement error:", e)
  );

  return NextResponse.json({ ok: true, call_id: callId });
}
