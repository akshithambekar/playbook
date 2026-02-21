import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();

  const [totalCallsRes, analyzedCallsRes, latestCallRes] = await Promise.all([
    supabase.from("calls").select("id", { count: "exact", head: true }),
    supabase.from("call_analysis").select("id", { count: "exact", head: true }),
    supabase
      .from("calls")
      .select("id, elevenlabs_conversation_id, transcript, created_at, call_analysis(id)")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (totalCallsRes.error) {
    return NextResponse.json({ error: totalCallsRes.error.message }, { status: 500 });
  }
  if (analyzedCallsRes.error) {
    return NextResponse.json({ error: analyzedCallsRes.error.message }, { status: 500 });
  }
  if (latestCallRes.error) {
    return NextResponse.json({ error: latestCallRes.error.message }, { status: 500 });
  }

  const latest = latestCallRes.data;
  const hasAnalysis = Boolean(
    latest?.call_analysis &&
      Array.isArray(latest.call_analysis) &&
      latest.call_analysis.length > 0
  );

  return NextResponse.json({
    total_calls: totalCallsRes.count ?? 0,
    analyzed_calls: analyzedCallsRes.count ?? 0,
    latest_call: latest
      ? {
          id: latest.id,
          conversation_id: latest.elevenlabs_conversation_id,
          created_at: latest.created_at,
          transcript_preview: (latest.transcript ?? "").slice(0, 180),
          has_analysis: hasAnalysis,
        }
      : null,
  });
}
