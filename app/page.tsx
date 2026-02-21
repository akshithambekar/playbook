import { createClient } from "@/lib/supabase/server";
import { AgentConsole } from "./components/AgentConsole";

export default async function Home() {
  const supabase = await createClient();

  const [playbooksRes, totalCallsRes, analyzedCallsRes, latestCallRes] = await Promise.all([
    supabase
      .from("playbooks")
      .select("*")
      .order("version", { ascending: false }),
    supabase
      .from("improvement_logs")
      .select("id", { count: "exact", head: true }),
    supabase.from("call_analysis").select("id", { count: "exact", head: true }),
    supabase
      .from("calls")
      .select("id, elevenlabs_conversation_id, transcript, created_at, call_analysis(id)")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const playbooks = playbooksRes.data ?? [];
  const latestCall = latestCallRes.data;

  if (playbooks.length === 0) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-slate-500 text-sm" style={{ fontFamily: "var(--font-jetbrains-mono)" }}>
          No playbook found —{" "}
          <span className="text-amber-400">run supabase/seed.sql</span> to seed
          the database.
        </p>
      </div>
    );
  }

  return (
    <AgentConsole
      initialPlaybooks={playbooks}
      initialSummary={{
        totalCalls: totalCallsRes.count ?? 0,
        analyzedCalls: analyzedCallsRes.count ?? 0,
        latestCall: latestCall
          ? {
              id: latestCall.id,
              conversationId: latestCall.elevenlabs_conversation_id,
              createdAt: latestCall.created_at,
              transcriptPreview: (latestCall.transcript ?? "").slice(0, 180),
              hasAnalysis:
                Array.isArray(latestCall.call_analysis) &&
                latestCall.call_analysis.length > 0,
            }
          : null,
      }}
    />
  );
}
