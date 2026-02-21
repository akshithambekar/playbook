import db from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  const playbook = db
    .prepare(`SELECT * FROM playbooks ORDER BY version DESC LIMIT 1`)
    .get();

  if (!playbook) {
    return NextResponse.json({ error: "No playbook found" }, { status: 404 });
  }

  return NextResponse.json(playbook);
}
