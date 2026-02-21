import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Returns all calls + their analysis since the last improvement cycle.
// Airia uses this as its data input to decide how to rewrite the playbook.
export async function GET() {
  const supabase = await createClient();

  // Find the timestamp of the last improvement
  const { data: lastLog } = await supabase
    .from("improvement_logs")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const since = lastLog?.created_at ?? new Date(0).toISOString();

  const { data, error } = await supabase
    .from("calls")
    .select(
      `
      id,
      elevenlabs_conversation_id,
      transcript,
      outcome,
      main_objection,
      interest_level,
      playbook_id,
      created_at,
      call_analysis (
        engagement_score,
        engagement_trend,
        prospect_emotions,
        agent_tone,
        deception_flags,
        key_moments
      )
    `
    )
    .gte("created_at", since)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    since,
    count: data.length,
    calls: data,
  });
}
