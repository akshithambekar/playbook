import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const body = await request.json();

  // Get the current max version so we can auto-increment
  const { data: latest, error: versionError } = await supabase
    .from("playbooks")
    .select("version")
    .order("version", { ascending: false })
    .limit(1)
    .single();

  if (versionError && versionError.code !== "PGRST116") {
    return NextResponse.json({ error: versionError.message }, { status: 500 });
  }

  const nextVersion = (latest?.version ?? 0) + 1;

  const { data, error } = await supabase
    .from("playbooks")
    .insert({
      version: nextVersion,
      strategy: body.strategy,
      opener: body.opener,
      objection_style: body.objection_style,
      tone: body.tone,
      close_technique: body.close_technique,
      rationale: body.rationale,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
