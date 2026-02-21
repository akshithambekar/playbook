import { createClient } from "@/lib/supabase/server";
import { AgentConsole } from "./components/AgentConsole";

export default async function Home() {
  const supabase = await createClient();

  // Fetch latest playbook + last improvement log in parallel
  const [playbookRes, lastLogRes] = await Promise.all([
    supabase
      .from("playbooks")
      .select("*")
      .order("version", { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from("improvement_logs")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
  ]);

  const playbook = playbookRes.data;
  const since = lastLogRes.data?.created_at ?? new Date(0).toISOString();

  // Count calls since last improvement + fetch recent logs in parallel
  const [callCountRes, logsRes] = await Promise.all([
    supabase
      .from("calls")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since),
    supabase
      .from("improvement_logs")
      .select("id, calls_analyzed, analysis_summary, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const batchSize = parseInt(process.env.IMPROVEMENT_BATCH_SIZE ?? "3", 10);

  if (!playbook) {
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
      playbook={playbook}
      callsSinceLast={callCountRes.count ?? 0}
      batchSize={batchSize}
      improvementLogs={logsRes.data ?? []}
    />
  );
}
