import { NextResponse } from "next/server";

export async function GET() {
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  const apiKey = process.env.ELEVENLABS_API_KEY;

  if (!agentId || agentId === "your_agent_id_here") {
    return NextResponse.json(
      { error: "ELEVENLABS_AGENT_ID not configured — create an agent in the ElevenLabs console first" },
      { status: 503 }
    );
  }

  if (!apiKey) {
    return NextResponse.json(
      { error: "ELEVENLABS_API_KEY not configured" },
      { status: 503 }
    );
  }

  const res = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agentId}`,
    { headers: { "xi-api-key": apiKey } }
  );

  if (!res.ok) {
    const text = await res.text();
    console.error("[signed-url] ElevenLabs API error:", res.status, text);
    return NextResponse.json(
      { error: "Failed to get signed URL from ElevenLabs", detail: text },
      { status: 502 }
    );
  }

  const data = await res.json();
  return NextResponse.json({ signed_url: data.signed_url });
}
