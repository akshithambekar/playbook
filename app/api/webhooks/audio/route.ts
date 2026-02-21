import { createClient } from "@/lib/supabase/server";
import { analyzeCall } from "@/lib/velma/analyze";
import { NextResponse } from "next/server";

// ElevenLabs post-call audio webhook payload
type ElevenLabsAudioWebhook = {
  conversation_id: string;
  // Base64-encoded audio from ElevenLabs
  audio?: string;
  audio_base64?: string;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const body: ElevenLabsAudioWebhook = await request.json();

  const conversationId = body.conversation_id;
  if (!conversationId) {
    return NextResponse.json(
      { error: "Missing conversation_id" },
      { status: 400 }
    );
  }

  const b64Audio = body.audio ?? body.audio_base64;
  if (!b64Audio) {
    return NextResponse.json({ error: "Missing audio payload" }, { status: 400 });
  }

  // Decode base64 → Buffer for Velma
  const audioBuffer = Buffer.from(b64Audio, "base64");

  // Look up the call row by conversation_id
  const { data: call, error: callError } = await supabase
    .from("calls")
    .select("id")
    .eq("elevenlabs_conversation_id", conversationId)
    .single();

  if (callError || !call) {
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
    call.id = upserted.id;
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
      { call_id: call.id, ...analysis },
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

  return NextResponse.json({ ok: true, call_id: call.id });
}
