import type { CallClassification } from './classifier.js';

export interface CallResult {
  callId: string;
  transcript: string;
  label: 'scam' | 'legit';
  score: number;
  category: string | null;
  model: string;
  completedAt: string;
}

export interface CallResultPublisherOptions {
  url: string;
  token: string;
  timeoutMs: number;
}

export async function publishCallResult(
  options: CallResultPublisherOptions,
  callId: string,
  transcript: string,
  classification: CallClassification,
): Promise<void> {
  const endpoint = new URL(options.url);
  if (endpoint.protocol !== 'https:' && endpoint.hostname !== 'localhost' && endpoint.hostname !== '127.0.0.1') {
    throw new Error('Call result endpoint must use HTTPS outside local development');
  }

  const result: CallResult = {
    callId,
    transcript,
    label: classification.label,
    score: classification.score,
    category: classification.category,
    model: classification.model,
    completedAt: new Date().toISOString(),
  };
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ schema: 't-gate.voice-call-result', version: 1, call: result }),
    signal: AbortSignal.timeout(options.timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Call result API returned HTTP ${response.status}`);
  }
}
