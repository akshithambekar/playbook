import db from "@/lib/db";
import { NextResponse } from "next/server";

type RawCallRow = {
  id: string;
  elevenlabs_conversation_id: string;
  transcript: string | null;
  outcome: string | null;
  main_objection: string | null;
  interest_level: string | null;
  playbook_id: string | null;
  created_at: string;
  engagement_score: number | null;
  engagement_trend: string | null;
  prospect_emotions: string | null;
  agent_tone: string | null;
  deception_flags: string | null;
  key_moments: string | null;
};

// Returns all calls + their analysis since the last improvement cycle.
// Airia uses this as its data input to decide how to rewrite the playbook.
export async function GET() {
  const lastLog = db
    .prepare(
      `SELECT created_at FROM improvement_logs ORDER BY created_at DESC LIMIT 1`
    )
    .get() as { created_at: string } | undefined;

  const since = lastLog?.created_at ?? new Date(0).toISOString();

  const rows = db
    .prepare(
      `SELECT
        c.id,
        c.elevenlabs_conversation_id,
        c.transcript,
        c.outcome,
        c.main_objection,
        c.interest_level,
        c.playbook_id,
        c.created_at,
        ca.engagement_score,
        ca.engagement_trend,
        ca.prospect_emotions,
        ca.agent_tone,
        ca.deception_flags,
        ca.key_moments
      FROM calls c
      LEFT JOIN call_analysis ca ON ca.call_id = c.id
      WHERE c.created_at >= ?
      ORDER BY c.created_at ASC`
    )
    .all(since) as RawCallRow[];

  const calls = rows.map((row) => ({
    id: row.id,
    elevenlabs_conversation_id: row.elevenlabs_conversation_id,
    transcript: row.transcript,
    outcome: row.outcome,
    main_objection: row.main_objection,
    interest_level: row.interest_level,
    playbook_id: row.playbook_id,
    created_at: row.created_at,
    call_analysis:
      row.engagement_score !== null ||
      row.engagement_trend !== null ||
      row.agent_tone !== null
        ? {
            engagement_score: row.engagement_score,
            engagement_trend: row.engagement_trend,
            prospect_emotions: row.prospect_emotions
              ? JSON.parse(row.prospect_emotions)
              : null,
            agent_tone: row.agent_tone,
            deception_flags: row.deception_flags
              ? JSON.parse(row.deception_flags)
              : null,
            key_moments: row.key_moments
              ? JSON.parse(row.key_moments)
              : null,
          }
        : null,
  }));

  return NextResponse.json({
    since,
    count: calls.length,
    calls,
  });
}
