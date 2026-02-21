import db from "@/lib/db";
import { NextResponse } from "next/server";

export async function POST() {
  const batchSize = parseInt(process.env.IMPROVEMENT_BATCH_SIZE ?? "1", 10);

  // Find the timestamp of the last improvement so we only count new calls
  const lastLog = db
    .prepare(
      `SELECT created_at FROM improvement_logs ORDER BY created_at DESC LIMIT 1`
    )
    .get() as { created_at: string } | undefined;

  const since = lastLog?.created_at ?? new Date(0).toISOString();

  // Count calls that have completed analysis since the last improvement
  const { count } = db
    .prepare(
      `SELECT COUNT(*) as count FROM calls WHERE created_at >= ?`
    )
    .get(since) as { count: number };

  const callsSince = count ?? 0;

  if (callsSince < batchSize) {
    return NextResponse.json({
      triggered: false,
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

  const airiaRes = await fetch(airiaUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(airiaKey ? { Authorization: `Bearer ${airiaKey}` } : {}),
    },
    body: JSON.stringify({ calls_since: callsSince, triggered_at: new Date().toISOString() }),
  });

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
