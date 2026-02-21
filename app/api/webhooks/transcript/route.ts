import { createClient } from "@/lib/supabase/server";
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

export async function POST(request: Request) {
  const supabase = await createClient();
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
  const { data: latestPlaybook } = await supabase
    .from("playbooks")
    .select("id")
    .order("version", { ascending: false })
    .limit(1)
    .single();

  const { data, error } = await supabase
    .from("calls")
    .upsert(
      {
        elevenlabs_conversation_id: conversationId,
        transcript: body.transcript ?? null,
        outcome: outcome as
          | "converted"
          | "no_close"
          | "callback"
          | "hung_up"
          | null,
        main_objection: mainObjection,
        interest_level: interestLevel,
        playbook_id: latestPlaybook?.id ?? null,
      },
      { onConflict: "elevenlabs_conversation_id" }
    )
    .select()
    .single();

  if (error) {
    console.error("[webhook/transcript] DB error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, call_id: data.id });
}
