export type Playbook = {
  id: string;
  version: number;
  strategy: string;
  opener: string;
  objection_style: string;
  tone: string;
  close_technique: string;
  rationale: string;
  created_at: string;
};

export type Call = {
  id: string;
  elevenlabs_conversation_id: string;
  transcript: string | null;
  outcome: "converted" | "no_close" | "callback" | "hung_up" | null;
  main_objection: string | null;
  interest_level: string | null;
  playbook_id: string | null;
  created_at: string;
};

export type CallAnalysis = {
  id: string;
  call_id: string;
  engagement_score: number | null;
  engagement_trend: string | null;
  prospect_emotions: ProspectEmotion[] | null;
  agent_tone: string | null;
  deception_flags: DeceptionFlag[] | null;
  key_moments: KeyMoment[] | null;
  created_at: string;
};

export type ImprovementLog = {
  id: string;
  calls_analyzed: number;
  old_playbook_id: string | null;
  new_playbook_id: string | null;
  analysis_summary: string | null;
  created_at: string;
};

export type ProspectEmotion = {
  timestamp_seconds: number;
  emotion: string;
  intensity: number;
};

export type DeceptionFlag = {
  timestamp_seconds: number;
  type: string;
  description: string;
};

export type KeyMoment = {
  timestamp_seconds: number;
  label: string;
  description: string;
};

// Shape returned by GET /api/calls/recent (for Airia consumption)
export type RecentCallWithAnalysis = Call & {
  call_analysis: CallAnalysis | null;
};
