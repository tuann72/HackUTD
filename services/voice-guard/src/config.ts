export interface VoiceGuardConfig {
  captureEnabled: boolean;
  classifierUrl?: string;
  classifierToken?: string;
  classifierTimeoutMs: number;
  callResultsUrl?: string;
  callResultsToken?: string;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): VoiceGuardConfig {
  const classifierUrl = env.CLASSIFIER_URL?.trim();
  const classifierToken = env.CLASSIFIER_TOKEN?.trim();
  const timeoutValue = env.CLASSIFIER_TIMEOUT_MS?.trim();
  const classifierTimeoutMs = timeoutValue ? Number(timeoutValue) : 10_000;
  const callResultsUrl = env.VOICE_GUARD_RESULTS_URL?.trim();
  const callResultsToken = env.VOICE_GUARD_RESULTS_INGEST_TOKEN?.trim();

  if (classifierUrl && !classifierToken) {
    throw new Error('CLASSIFIER_TOKEN is required when CLASSIFIER_URL is set');
  }

  if ((callResultsUrl && !callResultsToken) || (!callResultsUrl && callResultsToken)) {
    throw new Error('VOICE_GUARD_RESULTS_URL and VOICE_GUARD_RESULTS_INGEST_TOKEN must be set together');
  }

  if (!Number.isInteger(classifierTimeoutMs) || classifierTimeoutMs <= 0) {
    throw new Error('CLASSIFIER_TIMEOUT_MS must be a positive integer');
  }

  return {
    captureEnabled: env.VOICE_GUARD_CAPTURE_ENABLED === 'true',
    ...(classifierUrl ? { classifierUrl } : {}),
    ...(classifierToken ? { classifierToken } : {}),
    ...(callResultsUrl ? { callResultsUrl } : {}),
    ...(callResultsToken ? { callResultsToken } : {}),
    classifierTimeoutMs,
  };
}
