export interface ClassifierOptions {
  baseUrl: string;
  token: string;
  timeoutMs: number;
}

export interface CallClassification {
  label: 'scam' | 'legit';
  score: number;
  category: string | null;
  model: string;
}

function isCallClassification(value: unknown): value is CallClassification {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Record<string, unknown>;

  return (
    (result.label === 'scam' || result.label === 'legit') &&
    typeof result.score === 'number' &&
    Number.isFinite(result.score) &&
    (typeof result.category === 'string' || result.category === null) &&
    typeof result.model === 'string'
  );
}

export async function classifyTranscript(
  options: ClassifierOptions,
  messageId: string,
  text: string,
): Promise<CallClassification> {
  const endpoint = new URL('/classify', options.baseUrl);
  if (endpoint.protocol !== 'https:' && endpoint.hostname !== 'localhost' && endpoint.hostname !== '127.0.0.1') {
    throw new Error('Classifier endpoint must use HTTPS outside local development');
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messageId, text }),
    signal: AbortSignal.timeout(options.timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Classifier returned HTTP ${response.status}`);
  }

  const result: unknown = await response.json();
  if (!isCallClassification(result)) {
    throw new Error('Classifier returned an invalid response');
  }

  return result;
}
