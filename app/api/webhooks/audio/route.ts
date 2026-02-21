import db from "@/lib/db";
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
  let existingCall = db
    .prepare(`SELECT id FROM calls WHERE elevenlabs_conversation_id = ?`)
    .get(conversationId) as { id: string } | undefined;

  let callId: string;

  if (!existingCall) {
    // Transcript webhook may not have fired yet — insert a minimal calls row
    callId = crypto.randomUUID();
    try {
      db.prepare(
        `INSERT INTO calls (id, elevenlabs_conversation_id, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT(elevenlabs_conversation_id) DO UPDATE SET
           elevenlabs_conversation_id = excluded.elevenlabs_conversation_id`
      ).run(callId, conversationId, new Date().toISOString());

      // Re-fetch to handle the case where a concurrent insert won the conflict
      existingCall = db
        .prepare(`SELECT id FROM calls WHERE elevenlabs_conversation_id = ?`)
        .get(conversationId) as { id: string } | undefined;

      if (!existingCall) {
        return NextResponse.json(
          { error: "Could not resolve call row" },
          { status: 500 }
        );
      }
      callId = existingCall.id;
    } catch (err) {
      return NextResponse.json(
        { error: "Could not resolve call row", detail: String(err) },
        { status: 500 }
      );
    }
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
  try {
    const analysisId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO call_analysis
         (id, call_id, engagement_score, engagement_trend, prospect_emotions, agent_tone, deception_flags, key_moments, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(call_id) DO UPDATE SET
         engagement_score  = excluded.engagement_score,
         engagement_trend  = excluded.engagement_trend,
         prospect_emotions = excluded.prospect_emotions,
         agent_tone        = excluded.agent_tone,
         deception_flags   = excluded.deception_flags,
         key_moments       = excluded.key_moments`
    ).run(
      analysisId,
      callId,
      analysis.engagement_score ?? null,
      analysis.engagement_trend ?? null,
      analysis.prospect_emotions != null
        ? JSON.stringify(analysis.prospect_emotions)
        : null,
      analysis.agent_tone ?? null,
      analysis.deception_flags != null
        ? JSON.stringify(analysis.deception_flags)
        : null,
      analysis.key_moments != null
        ? JSON.stringify(analysis.key_moments)
        : null,
      new Date().toISOString()
    );
  } catch (err) {
    console.error("[webhook/audio] DB error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  // Fire improvement check asynchronously — don't block the webhook response
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  fetch(`${baseUrl}/api/trigger-improvement`, { method: "POST" }).catch((e) =>
    console.error("[webhook/audio] trigger-improvement error:", e)
  );

  return NextResponse.json({ ok: true, call_id: callId });
}
