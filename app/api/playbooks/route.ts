import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type PlaybookPayload = {
  strategy: string;
  opener: string;
  objection_style: string;
  tone: string;
  close_technique: string;
  rationale: string;
};

export async function GET() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("playbooks")
    .select("*")
    .order("version", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ playbooks: data ?? [] });
}

/**
 * Robustly parse the request body.
 *
 * Airia's formatter emits several non-standard shapes:
 *   1. [{Key: "strategy", Value: "..."}, ...]  — unquoted keys, Key/Value array
 *   2. Markdown code fences: ```json ... ```
 *   3. A top-level wrapper key: { "playbook": {...} }
 *   4. Double-stringified JSON: "\"{ ... }\""
 */
async function parseBody(request: Request): Promise<{ data: PlaybookPayload | null; raw: string; error?: string }> {
  const raw = await request.text();

  // Strip markdown code fences
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  // ── Strategy 1: Airia Key/Value array ──────────────────────────────────
  // Shape: [{Key: "strategy", Value: "..."}, {Key: "opener", Value: "..."}, ...]
  // Property names are unquoted — fix them with a regex before JSON.parse.
  if (stripped.startsWith("[")) {
    try {
      // Quote any bare identifier that immediately precedes a colon
      const fixed = stripped.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3');
      const arr = JSON.parse(fixed) as Array<Record<string, string>>;
      if (Array.isArray(arr) && arr.length > 0 && ("Key" in arr[0] || "key" in arr[0])) {
        const obj: Record<string, string> = {};
        for (const item of arr) {
          const k = (item.Key ?? item.key ?? "").toLowerCase().replace(/\s+/g, "_");
          const v = item.Value ?? item.value ?? "";
          if (k) obj[k] = v;
        }
        return { data: obj as unknown as PlaybookPayload, raw };
      }
    } catch {
      // fall through to other strategies
    }
  }

  // ── Strategy 2: Standard JSON parse ────────────────────────────────────
  let parsed: unknown;
  try {
    // Also fix unquoted top-level keys just in case
    const fixed = stripped.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3');
    parsed = JSON.parse(fixed);
  } catch {
    return { data: null, raw, error: `Invalid JSON: ${stripped.slice(0, 300)}` };
  }

  // ── Strategy 3: Double-stringified ─────────────────────────────────────
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return { data: null, raw, error: "Body was a JSON string but its contents are not valid JSON" };
    }
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { data: null, raw, error: "Body must be a JSON object" };
  }

  // ── Strategy 4: Unwrap single-key wrapper objects ──────────────────────
  const obj = parsed as Record<string, unknown>;
  const WRAPPER_KEYS = ["playbook", "result", "output", "data", "payload"];
  let target: Record<string, unknown> = obj;

  for (const key of WRAPPER_KEYS) {
    if (
      Object.keys(obj).length === 1 &&
      key in obj &&
      typeof obj[key] === "object" &&
      obj[key] !== null
    ) {
      target = obj[key] as Record<string, unknown>;
      break;
    }
  }

  return { data: target as PlaybookPayload, raw };
}

export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: body, raw, error: parseError } = await parseBody(request);

  if (!body || parseError) {
    console.error("[POST /api/playbooks] Parse error:", parseError, "| Raw:", raw.slice(0, 500));
    return NextResponse.json(
      { error: "Could not parse request body", detail: parseError, raw: raw.slice(0, 500) },
      { status: 400 }
    );
  }

  // Validate required fields
  const required: (keyof PlaybookPayload)[] = [
    "strategy", "opener", "objection_style", "tone", "close_technique", "rationale",
  ];
  const missing = required.filter((k) => !body[k]);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing required fields: ${missing.join(", ")}` },
      { status: 400 }
    );
  }

  // Auto-increment version
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
