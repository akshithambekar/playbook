import db from "@/lib/db";
import { NextResponse } from "next/server";

// ElevenLabs ConvAI conversation detail response
type ElevenLabsConversation = {
  conversation_id: string;
  status: string;
  transcript?: Array<{ role: string; message: string; time_in_call_secs: number }>;
  data_collection_results?: {
    outcome?: { value: string };
    main_objection?: { value: string };
    interest_level?: { value: string };
  };
  metadata?: {
    agent_id?: string;
  };
};

export async function POST(request: Request) {
  const { conversation_id } = await request.json();

  if (!conversation_id) {
    return NextResponse.json({ error: "Missing conversation_id" }, { status: 400 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ELEVENLABS_API_KEY not configured" }, { status: 503 });
  }

  // Fetch conversation details from ElevenLabs
  const elRes = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversations/${conversation_id}`,
    { headers: { "xi-api-key": apiKey } }
  );

  if (!elRes.ok) {
    const detail = await elRes.text();
    console.error("[save-transcript] ElevenLabs fetch error:", elRes.status, detail);
    return NextResponse.json(
      { error: "Failed to fetch conversation from ElevenLabs", detail },
      { status: 502 }
    );
  }

  const conv: ElevenLabsConversation = await elRes.json();

  // Flatten the transcript array into a single string (same format ElevenLabs webhooks use)
  const transcriptText = conv.transcript
    ? conv.transcript.map((t) => `${t.role}: ${t.message}`).join("\n")
    : null;

  const outcome = conv.data_collection_results?.outcome?.value ?? null;
  const mainObjection = conv.data_collection_results?.main_objection?.value ?? null;
  const interestLevel = conv.data_collection_results?.interest_level?.value ?? null;

  const latestPlaybook = db
    .prepare(`SELECT id FROM playbooks ORDER BY version DESC LIMIT 1`)
    .get() as { id: string } | undefined;

  try {
    const existing = db
      .prepare(`SELECT id FROM calls WHERE elevenlabs_conversation_id = ?`)
      .get(conversation_id) as { id: string } | undefined;

    let callId: string;

    if (existing) {
      db.prepare(
        `UPDATE calls
         SET transcript = ?,
             outcome = ?,
             main_objection = ?,
             interest_level = ?,
             playbook_id = COALESCE(playbook_id, ?)
         WHERE elevenlabs_conversation_id = ?`
      ).run(
        transcriptText,
        outcome,
        mainObjection,
        interestLevel,
        latestPlaybook?.id ?? null,
        conversation_id
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
        conversation_id,
        transcriptText,
        outcome,
        mainObjection,
        interestLevel,
        latestPlaybook?.id ?? null,
        new Date().toISOString()
      );
    }

    return NextResponse.json({ ok: true, call_id: callId });
  } catch (err) {
    console.error("[save-transcript] DB error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
