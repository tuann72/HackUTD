import { timingSafeEqual } from 'node:crypto';
import { MongoClient, type Collection } from 'mongodb';
import type { VoiceCallResult } from '../voice/types';

export interface VoiceResultsConfig {
  ingestToken: string | null;
  viewToken: string | null;
  ttlSeconds: number | null;
}

export function voiceResultsConfig(env: NodeJS.ProcessEnv = process.env): VoiceResultsConfig {
  const ttl = env.VOICE_GUARD_RESULTS_TTL_SECONDS?.trim();
  const parsedTtl = ttl ? Number(ttl) : NaN;
  return {
    ingestToken: env.VOICE_GUARD_RESULTS_INGEST_TOKEN?.trim() || null,
    viewToken: env.VOICE_GUARD_RESULTS_VIEW_TOKEN?.trim() || null,
    ttlSeconds: Number.isSafeInteger(parsedTtl) && parsedTtl > 0 ? parsedTtl : null,
  };
}

export function hasBearerToken(request: Request, expected: string | null): boolean {
  if (!expected) return false;
  const authorization = request.headers.get('authorization') ?? '';
  const supplied = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).every((key) => expected.includes(key)) && expected.every((key) => key in value);
}

export function parseVoiceCallSubmission(value: unknown): VoiceCallResult | null {
  if (
    !isRecord(value) || !hasExactKeys(value, ['schema', 'version', 'call']) ||
    value.schema !== 't-gate.voice-call-result' || value.version !== 1 || !isRecord(value.call) ||
    !hasExactKeys(value.call, ['callId', 'transcript', 'label', 'score', 'category', 'model', 'completedAt'])
  ) {
    return null;
  }

  const call = value.call;
  const completedAt = typeof call.completedAt === 'string' ? Date.parse(call.completedAt) : NaN;
  if (
    typeof call.callId !== 'string' || call.callId.length < 1 || call.callId.length > 128 ||
    typeof call.transcript !== 'string' || call.transcript.trim().length === 0 || call.transcript.length > 50_000 ||
    (call.label !== 'scam' && call.label !== 'legit') ||
    typeof call.score !== 'number' || !Number.isFinite(call.score) || call.score < 0 || call.score > 1 ||
    !(typeof call.category === 'string' || call.category === null) ||
    typeof call.model !== 'string' || call.model.length < 1 || call.model.length > 128 ||
    !Number.isFinite(completedAt)
  ) {
    return null;
  }

  return {
    callId: call.callId,
    transcript: call.transcript,
    label: call.label,
    score: call.score,
    category: call.category,
    model: call.model,
    completedAt: new Date(completedAt).toISOString(),
  };
}

export interface VoiceCallResultsStore {
  save(call: VoiceCallResult, expiresAt: Date): Promise<void>;
  list(limit: number, now: Date): Promise<VoiceCallResult[]>;
}

interface VoiceCallResultDocument extends VoiceCallResult {
  _id: string;
  expiresAt: Date;
}

export class MemoryVoiceCallResultsStore implements VoiceCallResultsStore {
  private readonly rows = new Map<string, VoiceCallResultDocument>();

  private prune(now: Date): void {
    for (const [id, row] of this.rows) if (row.expiresAt <= now) this.rows.delete(id);
  }

  async save(call: VoiceCallResult, expiresAt: Date): Promise<void> {
    this.prune(new Date());
    this.rows.set(call.callId, { ...call, _id: call.callId, expiresAt });
  }

  async list(limit: number, now: Date): Promise<VoiceCallResult[]> {
    this.prune(now);
    return [...this.rows.values()]
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
      .slice(0, limit)
      .map(({ _id: _ignoredId, expiresAt: _ignoredExpiry, ...call }) => call);
  }
}

class MongoVoiceCallResultsStore implements VoiceCallResultsStore {
  constructor(private readonly collection: Collection<VoiceCallResultDocument>) {}

  async save(call: VoiceCallResult, expiresAt: Date): Promise<void> {
    await this.collection.replaceOne(
      { _id: call.callId },
      { ...call, expiresAt },
      { upsert: true },
    );
  }

  async list(limit: number, now: Date): Promise<VoiceCallResult[]> {
    const rows = await this.collection
      .find({ expiresAt: { $gt: now } }, { projection: { _id: 0, expiresAt: 0 } })
      .sort({ completedAt: -1 })
      .limit(limit)
      .toArray();
    return rows as VoiceCallResult[];
  }
}

type VoiceResultsGlobals = typeof globalThis & {
  __tgateVoiceResultsClient?: Promise<MongoClient>;
  __tgateVoiceResultsCollection?: Promise<Collection<VoiceCallResultDocument>>;
  __tgateVoiceResultsMemory?: MemoryVoiceCallResultsStore;
};

const globals = globalThis as VoiceResultsGlobals;

/** Atlas is durable on Vercel; the memory fallback is for local development only. */
export async function getVoiceCallResultsStore(
  env: NodeJS.ProcessEnv = process.env,
): Promise<VoiceCallResultsStore> {
  if (!env.MONGODB_URI) {
    if (env.VERCEL) throw new Error('MONGODB_URI is required for voice results on Vercel');
    return (globals.__tgateVoiceResultsMemory ??= new MemoryVoiceCallResultsStore());
  }

  const clientPromise = (globals.__tgateVoiceResultsClient ??=
    new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 }).connect());
  globals.__tgateVoiceResultsCollection ??= clientPromise.then(async (client) => {
    const collection = client.db(env.MONGODB_DB || 'tgate').collection<VoiceCallResultDocument>('voiceCallResults');
    await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'voice_call_results_ttl' });
    return collection;
  });

  try {
    return new MongoVoiceCallResultsStore(await globals.__tgateVoiceResultsCollection);
  } catch (error) {
    globals.__tgateVoiceResultsClient = undefined;
    globals.__tgateVoiceResultsCollection = undefined;
    throw error;
  }
}
