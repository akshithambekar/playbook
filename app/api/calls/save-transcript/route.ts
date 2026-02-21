import { createClient } from "@/lib/supabase/server";
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
  const supabase = await createClient();
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

  // Flatten the transcript array into a single string (same format ElevenLabs webhooks use).
  // Important: ElevenLabs may return an empty array immediately after disconnect.
  const transcriptTurns = Array.isArray(conv.transcript) ? conv.transcript : [];
  const transcriptText = transcriptTurns
    .map((t) => `${t.role}: ${t.message}`)
    .join("\n")
    .trim();
  const hasTranscript = transcriptTurns.length > 0 && transcriptText.length > 0;

  const outcome = conv.data_collection_results?.outcome?.value ?? null;
  const mainObjection = conv.data_collection_results?.main_objection?.value ?? null;
  const interestLevel = conv.data_collection_results?.interest_level?.value ?? null;

  const { data: latestPlaybook } = await supabase
    .from("playbooks")
    .select("id")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  try {
    const { data: existing } = await supabase
      .from("calls")
      .select("id, transcript")
      .eq("elevenlabs_conversation_id", conversation_id)
      .maybeSingle();

    let callId: string;

    if (existing) {
      const updatePayload: Record<string, unknown> = {
        outcome: outcome,
        main_objection: mainObjection,
        interest_level: interestLevel,
      };
      if (latestPlaybook?.id) updatePayload.playbook_id = latestPlaybook.id;
      if (hasTranscript) updatePayload.transcript = transcriptText;

      const { error: updateError } = await supabase
        .from("calls")
        .update(updatePayload)
        .eq("id", existing.id);
      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
      callId = existing.id;
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("calls")
        .insert({
          elevenlabs_conversation_id: conversation_id,
          transcript: hasTranscript ? transcriptText : null,
          outcome: outcome,
          main_objection: mainObjection,
          interest_level: interestLevel,
          playbook_id: latestPlaybook?.id ?? null,
        })
        .select("id")
        .single();
      if (insertError || !inserted) {
        return NextResponse.json(
          { error: insertError?.message ?? "Could not insert call row" },
          { status: 500 }
        );
      }
      callId = inserted.id;
    }

    if (!hasTranscript) {
      return NextResponse.json(
        {
          ok: false,
          pending: true,
          call_id: callId,
          conversation_status: conv.status,
          transcript_turns: transcriptTurns.length,
        },
        { status: 202 }
      );
    }

    return NextResponse.json({ ok: true, pending: false, call_id: callId });
  } catch (err) {
    console.error("[save-transcript] DB error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
