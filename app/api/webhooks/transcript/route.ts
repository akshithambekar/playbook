import db from "@/lib/db";
import { NextResponse } from "next/server";

// ElevenLabs post-call transcript webhook payload
type ElevenLabsTranscriptWebhook = {
  conversation_id: string;
  status: string;
  transcript?: string;
  data_collection_results?: {
    outcome?: { value: string };
    main_objection?: { value: string };
    interest_level?: { value: string };
  };
  metadata?: {
    agent_id?: string;
  };
};

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "POST /api/webhooks/transcript" });
}

export async function POST(request: Request) {
  const body: ElevenLabsTranscriptWebhook = await request.json();

  const conversationId = body.conversation_id;
  if (!conversationId) {
    return NextResponse.json(
      { error: "Missing conversation_id" },
      { status: 400 }
    );
  }

  const outcome = body.data_collection_results?.outcome?.value ?? null;
  const mainObjection =
    body.data_collection_results?.main_objection?.value ?? null;
  const interestLevel =
    body.data_collection_results?.interest_level?.value ?? null;

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
        body.transcript ?? null,
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
        body.transcript ?? null,
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
