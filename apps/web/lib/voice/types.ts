export interface VoiceCallResult {
  callId: string;
  transcript: string;
  label: 'scam' | 'legit';
  score: number;
  category: string | null;
  model: string;
  completedAt: string;
}

export interface VoiceCallResultsResponse {
  schema: 't-gate.voice-call-results';
  version: 1;
  calls: VoiceCallResult[];
}
