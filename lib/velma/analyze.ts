import type { CallAnalysis, ProspectEmotion, KeyMoment } from "@/lib/db/types";

// Velma API response types (from velma-2-stt-batch OpenAPI spec)
type VelmaUtterance = {
  utterance_uuid: string;
  text: string;
  start_ms: number;
  duration_ms: number;
  speaker: number;
  language: string;
  emotion: string | null;
  accent: string | null;
};

type VelmaResponse = {
  text: string;
  duration_ms: number;
  utterances: VelmaUtterance[];
};

// Emotions considered "engaged" / positive for the prospect
const ENGAGED_EMOTIONS = new Set([
  "Happy",
  "Amused",
  "Excited",
  "Proud",
  "Affectionate",
  "Interested",
  "Hopeful",
  "Confident",
  "Relieved",
]);

// Emotions that signal disengagement or friction
const DISENGAGED_EMOTIONS = new Set([
  "Bored",
  "Tired",
  "Disgusted",
  "Disappointed",
  "Contemptuous",
]);

const KEY_MOMENT_EMOTIONS = new Set([
  "Frustrated",
  "Angry",
  "Interested",
  "Excited",
  "Hopeful",
  "Confused",
  "Anxious",
  "Stressed",
  "Afraid",
  "Concerned",
  "Surprised",
]);

/**
 * Sends audio to Modulate Velma, then maps the utterance-level response
 * to our CallAnalysis schema.
 *
 * Speaker 1 = agent (ElevenLabs), Speaker 2 = prospect (human caller).
 * Velma assigns consistent speaker numbers within a single file.
 */
export async function analyzeCall(
  audioBuffer: Buffer,
  filename = "call.mp3"
): Promise<Omit<CallAnalysis, "id" | "call_id" | "created_at">> {
  const modulateKey = process.env.MODULATE_API_KEY;

  if (!modulateKey) {
    throw new Error("MODULATE_API_KEY must be set in environment variables");
  }

  const endpoint = "https://modulate-prototype-apis.com/api/velma-2-stt-batch";

  const formData = new FormData();
  const blob = new Blob([new Uint8Array(audioBuffer).buffer as ArrayBuffer], { type: "audio/mpeg" });
  formData.append("upload_file", blob, filename);
  formData.append("speaker_diarization", "true");
  formData.append("emotion_signal", "true");
  formData.append("accent_signal", "false");
  formData.append("pii_phi_tagging", "false");

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "X-API-Key": modulateKey },
    body: formData,
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Velma API error ${res.status}: ${detail}`);
  }

  const velma: VelmaResponse = await res.json();
  return mapVelmaToAnalysis(velma);
}

function mapVelmaToAnalysis(
  velma: VelmaResponse
): Omit<CallAnalysis, "id" | "call_id" | "created_at"> {
  // Assume speaker 1 = agent, speaker 2 = prospect.
  // If only one speaker was detected, treat all as prospect.
  const speakerIds = [...new Set(velma.utterances.map((u) => u.speaker))];
  const agentSpeaker = speakerIds.length >= 2 ? Math.min(...speakerIds) : null;

  const prospectUtterances = velma.utterances.filter((u) =>
    agentSpeaker === null ? true : u.speaker !== agentSpeaker
  );
  const agentUtterances =
    agentSpeaker !== null
      ? velma.utterances.filter((u) => u.speaker === agentSpeaker)
      : [];

  // --- engagement_score ---
  const emotionedProspect = prospectUtterances.filter((u) => u.emotion);
  let engagementScore: number | null = null;
  if (emotionedProspect.length > 0) {
    const engagedCount = emotionedProspect.filter((u) =>
      ENGAGED_EMOTIONS.has(u.emotion!)
    ).length;
    const disengagedCount = emotionedProspect.filter((u) =>
      DISENGAGED_EMOTIONS.has(u.emotion!)
    ).length;
    // Score = (engaged - disengaged) / total, scaled to [0, 1]
    const raw =
      (engagedCount - disengagedCount) / emotionedProspect.length;
    engagementScore = Math.max(0, Math.min(1, (raw + 1) / 2));
  }

  // --- engagement_trend ---
  // Compare avg engagement of first half vs second half of prospect utterances
  let engagementTrend: string | null = null;
  if (emotionedProspect.length >= 4) {
    const half = Math.floor(emotionedProspect.length / 2);
    const scoreHalf = (utterances: VelmaUtterance[]) => {
      const engaged = utterances.filter((u) =>
        ENGAGED_EMOTIONS.has(u.emotion!)
      ).length;
      const disengaged = utterances.filter((u) =>
        DISENGAGED_EMOTIONS.has(u.emotion!)
      ).length;
      return (engaged - disengaged) / utterances.length;
    };
    const firstScore = scoreHalf(emotionedProspect.slice(0, half));
    const secondScore = scoreHalf(emotionedProspect.slice(half));
    const delta = secondScore - firstScore;
    if (delta > 0.15) engagementTrend = "rising";
    else if (delta < -0.15) engagementTrend = "falling";
    else engagementTrend = "flat";
  }

  // --- prospect_emotions ---
  const prospectEmotions: ProspectEmotion[] = prospectUtterances
    .filter((u) => u.emotion && u.emotion !== "Neutral")
    .map((u) => ({
      timestamp_seconds: Math.round(u.start_ms / 1000),
      emotion: u.emotion!,
      // Derive rough intensity: key/strong emotions = 0.8, moderate = 0.5
      intensity: KEY_MOMENT_EMOTIONS.has(u.emotion!)
        ? 0.8
        : ENGAGED_EMOTIONS.has(u.emotion!) || DISENGAGED_EMOTIONS.has(u.emotion!)
        ? 0.6
        : 0.5,
    }));

  // --- agent_tone ---
  let agentTone: string | null = null;
  if (agentUtterances.length > 0) {
    const emotionCounts: Record<string, number> = {};
    agentUtterances.forEach((u) => {
      if (u.emotion) emotionCounts[u.emotion] = (emotionCounts[u.emotion] ?? 0) + 1;
    });
    const top = Object.entries(emotionCounts).sort((a, b) => b[1] - a[1])[0];
    agentTone = top ? top[0] : null;
  }

  // --- deception_flags ---
  // Flag utterances where prospect says positive/neutral text but sounds Bored/Disgusted/Tired/Contemptuous
  const deceptionFlags = prospectUtterances
    .filter((u) => DISENGAGED_EMOTIONS.has(u.emotion ?? ""))
    .map((u) => ({
      timestamp_seconds: Math.round(u.start_ms / 1000),
      type: "disengaged_tone",
      description: `Prospect sounds ${u.emotion?.toLowerCase()} — "${u.text.slice(0, 80)}"`,
    }));

  // --- key_moments ---
  const keyMoments: KeyMoment[] = prospectUtterances
    .filter((u) => KEY_MOMENT_EMOTIONS.has(u.emotion ?? ""))
    .map((u) => ({
      timestamp_seconds: Math.round(u.start_ms / 1000),
      label: u.emotion!,
      description: `"${u.text.slice(0, 120)}"`,
    }));

  return {
    engagement_score: engagementScore,
    engagement_trend: engagementTrend,
    prospect_emotions: prospectEmotions.length > 0 ? prospectEmotions : null,
    agent_tone: agentTone,
    deception_flags: deceptionFlags.length > 0 ? deceptionFlags : null,
    key_moments: keyMoments.length > 0 ? keyMoments : null,
  };
}
