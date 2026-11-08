import {
  getVoiceCallResultsStore,
  hasBearerToken,
  parseVoiceCallSubmission,
  voiceResultsConfig,
} from '@/lib/server/voiceResults';

const noStore = { 'Cache-Control': 'no-store' };

function unavailable(message: string) {
  return Response.json({ error: message }, { status: 503, headers: noStore });
}

export async function POST(request: Request) {
  const config = voiceResultsConfig();
  if (!config.ingestToken || !config.viewToken || !config.ttlSeconds) {
    return unavailable('Voice result storage is not configured');
  }
  if (!hasBearerToken(request, config.ingestToken)) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: noStore });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'body must be JSON' }, { status: 400, headers: noStore });
  }

  const call = parseVoiceCallSubmission(body);
  if (!call) {
    return Response.json({ error: 'invalid voice call result v1 payload' }, { status: 400, headers: noStore });
  }

  try {
    const store = await getVoiceCallResultsStore();
    const completedAtMs = Date.parse(call.completedAt);
    const now = Date.now();
    if (completedAtMs > now + 60_000) {
      return Response.json({ error: 'completedAt cannot be in the future' }, { status: 400, headers: noStore });
    }
    const expiresAt = new Date(Math.min(completedAtMs, now) + config.ttlSeconds * 1000);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) {
      return Response.json({ error: 'call result retention window has expired' }, { status: 410, headers: noStore });
    }
    await store.save(call, expiresAt);
    return Response.json({ accepted: true, callId: call.callId }, { status: 202, headers: noStore });
  } catch (error) {
    console.error('[voice results] save failed:', error instanceof Error ? error.name : 'Error');
    return unavailable('Voice result store is unavailable');
  }
}

export async function GET(request: Request) {
  const config = voiceResultsConfig();
  if (!config.viewToken || !config.ttlSeconds) {
    return unavailable('Voice result viewing is not configured');
  }
  if (!hasBearerToken(request, config.viewToken)) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: noStore });
  }

  const rawLimit = new URL(request.url).searchParams.get('limit');
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return Response.json({ error: 'limit must be an integer from 1 to 100' }, { status: 400, headers: noStore });
  }

  try {
    const calls = await (await getVoiceCallResultsStore()).list(limit, new Date());
    return Response.json(
      { schema: 't-gate.voice-call-results', version: 1, calls },
      { headers: noStore },
    );
  } catch (error) {
    console.error('[voice results] read failed:', error instanceof Error ? error.name : 'Error');
    return unavailable('Voice result store is unavailable');
  }
}
