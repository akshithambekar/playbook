import db from "@/lib/db";
import { AgentConsole, type Playbook } from "./components/AgentConsole";

export default async function Home() {
  const playbook = db
    .prepare(`SELECT * FROM playbooks ORDER BY version DESC LIMIT 1`)
    .get() as Playbook | undefined;

  const lastLog = db
    .prepare(
      `SELECT created_at FROM improvement_logs ORDER BY created_at DESC LIMIT 1`
    )
    .get() as { created_at: string } | undefined;

  const since = lastLog?.created_at ?? new Date(0).toISOString();

  const { count } = db
    .prepare(`SELECT COUNT(*) as count FROM calls WHERE created_at >= ?`)
    .get(since) as { count: number };

  const improvementLogs = db
    .prepare(
      `SELECT id, calls_analyzed, analysis_summary, created_at
       FROM improvement_logs
       ORDER BY created_at DESC
       LIMIT 5`
    )
    .all() as { id: string; calls_analyzed: number; analysis_summary: string | null; created_at: string }[];

  const batchSize = parseInt(process.env.IMPROVEMENT_BATCH_SIZE ?? "3", 10);

  if (!playbook) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-slate-500 text-sm" style={{ fontFamily: "var(--font-jetbrains-mono)" }}>
          No playbook found — database seed failed to run on startup.
        </p>
      </div>
    );
  }

  return (
    <AgentConsole
      playbook={playbook}
      callsSinceLast={count ?? 0}
      batchSize={batchSize}
      improvementLogs={improvementLogs}
    />
  );
}
