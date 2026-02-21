import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST() {
  const supabase = await createClient();
  const batchSize = parseInt(process.env.IMPROVEMENT_BATCH_SIZE ?? "1", 10);
  const airiaPaused =
    (process.env.AIRIA_PAUSED ?? "true").toLowerCase() !== "false";

  // Find the timestamp of the last improvement so we only count new calls
  const { data: lastLog } = await supabase
    .from("improvement_logs")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const since = lastLog?.created_at ?? new Date(0).toISOString();

  // Count calls that have completed analysis since the last improvement
  const { count, error: countError } = await supabase
    .from("calls")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);

  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }

  const callsSince = count ?? 0;

  if (callsSince < batchSize) {
    return NextResponse.json({
      triggered: false,
      calls_since_last_improvement: callsSince,
      threshold: batchSize,
    });
  }

  if (airiaPaused) {
    return NextResponse.json({
      triggered: false,
      paused: true,
      reason: "Airia calls are paused by AIRIA_PAUSED",
      calls_since_last_improvement: callsSince,
      threshold: batchSize,
    });
  }

  // Trigger Airia improvement pipeline
  const airiaUrl = process.env.AIRIA_WEBHOOK_URL;
  if (!airiaUrl) {
    return NextResponse.json(
      { error: "AIRIA_WEBHOOK_URL not configured" },
      { status: 500 }
    );
  }

  const airiaKey = process.env.AIRIA_API_KEY;
  const triggerContext = {
    calls_since: callsSince,
    triggered_at: new Date().toISOString(),
  };
  const payload = JSON.stringify({
    // Airia PipelineExecution API expects at least one of: UserInput, Images, Files.
    UserInput: JSON.stringify(triggerContext),
    context: triggerContext,
  });

  // Airia deployments can be configured to accept either X-API-Key or Bearer auth.
  // Try X-API-Key first, then retry with Bearer if needed.
  let airiaRes = await fetch(airiaUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(airiaKey ? { Authorization: `Bearer ${airiaKey}` } : {}),
    },
    body: payload,
  });

  if (!airiaRes.ok && airiaKey) {
    airiaRes = await fetch(airiaUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${airiaKey}`,
      },
      body: payload,
    });
  }

  if (!airiaRes.ok) {
    const text = await airiaRes.text();
    console.error("[trigger-improvement] Airia error:", airiaRes.status, text);
    return NextResponse.json(
      { error: "Airia webhook failed", detail: text },
      { status: 502 }
    );
  }

  return NextResponse.json({
    triggered: true,
    calls_since_last_improvement: callsSince,
    threshold: batchSize,
  });
}
