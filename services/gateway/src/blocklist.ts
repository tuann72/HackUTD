import { createHmac, randomBytes } from 'node:crypto';
import { MongoClient, type Collection } from 'mongodb';
import { normalizeHandle } from './handle.js';

// Sender blocklist and scam fingerprints (docs/features/sender-blocklist.md).
// Only keyed hashes leave the gateway: never a raw handle (number or email) or message text.

export interface Fingerprinter {
  /** Keyed hash of the sender's iMessage handle (number or Apple ID email). */
  sender(handle: string): string;
  /** Keyed hash of the normalized message text. */
  text(body: string): string;
}

/** Strip formatting so `+1 (555) 555-0142` and `+15555550142` hash the same. */
export function normalizeNumber(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

/** Lowercase, URLs and digit runs replaced, whitespace collapsed, so small variants of one scam match. */
export function normalizeText(body: string): string {
  return body
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|ly|io|co|info|biz|xyz|me|us)(?:\/\S*)?/g, '<url>')
    .replace(/\d+(?:[.,]\d+)*/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function makeFingerprinter(secret: string): Fingerprinter {
  if (!secret) throw new Error('fingerprint secret must not be empty');
  const hmac = (kind: string, value: string) => createHmac('sha256', secret).update(`${kind}:${value}`).digest('hex');
  return {
    sender: (handle) => hmac('sender', normalizeHandle(handle)),
    text: (body) => hmac('text', normalizeText(body)),
  };
}

/** A secret for this process only, for local runs without FINGERPRINT_SECRET. Hashes don't survive a restart. */
export function ephemeralSecret(): string {
  return randomBytes(32).toString('hex');
}

export interface BlocklistRules {
  /** Scam messages from one sender before it is blocklisted. */
  strikes: number;
  /** One message at or above this score blocklists the sender at once. */
  highScore: number;
  /** How long a block lasts. */
  ttlMs: number;
}

export interface ScamEvent {
  senderFp: string;
  textFp: string;
  score: number;
  category: string | null;
  model: string;
}

export interface RecordResult {
  strikes: number;
  /** The sender is on the blocklist after this event. */
  blocked: boolean;
  blockedUntil: Date | null;
}

export interface Blocklist {
  isBlocked(senderFp: string, now?: Date): Promise<boolean>;
  /** Record a blocked message's fingerprint and apply the strike and score rules. */
  recordScam(event: ScamEvent, now?: Date): Promise<RecordResult>;
  /** "Not a scam": lift the block and never blocklist this sender again. */
  allow(senderFp: string, now?: Date): Promise<void>;
  /**
   * "Clear blocks": delete every sender record (blocks, strikes and allowlist entries).
   * Text fingerprints are kept. Returns how many sender records were removed.
   */
  clear(): Promise<number>;
  /** How many senders are blocked right now (block not expired, not allowlisted), the same rule as isBlocked. */
  countBlocked(now?: Date): Promise<number>;
  close(): Promise<void>;
}

/** One sender's record. `_id` is the sender fingerprint. */
export interface SenderDoc {
  _id: string;
  strikes: number;
  maxScore: number;
  categories: string[];
  models: string[];
  firstSeen: Date;
  lastSeen: Date;
  blockedUntil: Date | null;
  allowlisted: boolean;
}

/** One normalized scam text. `_id` is the text fingerprint. */
export interface ScamTextDoc {
  _id: string;
  hits: number;
  maxScore: number;
  senders: string[];
  firstSeen: Date;
  lastSeen: Date;
}

/** The blocklist rule, shared by both implementations. Returns the new `blockedUntil`, or the old one. */
export function nextBlockedUntil(
  doc: Pick<SenderDoc, 'strikes' | 'allowlisted' | 'blockedUntil'>,
  score: number,
  rules: BlocklistRules,
  now: Date,
): Date | null {
  if (doc.allowlisted) return null;
  if (doc.strikes >= rules.strikes || score >= rules.highScore) return new Date(now.getTime() + rules.ttlMs);
  return doc.blockedUntil;
}

function isActive(doc: Pick<SenderDoc, 'allowlisted' | 'blockedUntil'> | undefined | null, now: Date): boolean {
  return !!doc && !doc.allowlisted && !!doc.blockedUntil && doc.blockedUntil.getTime() > now.getTime();
}

/** In-process blocklist: for tests, and for running the gateway without Atlas. */
export class MemoryBlocklist implements Blocklist {
  readonly senders = new Map<string, SenderDoc>();
  readonly texts = new Map<string, ScamTextDoc>();

  constructor(private readonly rules: BlocklistRules) {}

  async isBlocked(senderFp: string, now = new Date()): Promise<boolean> {
    return isActive(this.senders.get(senderFp), now);
  }

  async recordScam(e: ScamEvent, now = new Date()): Promise<RecordResult> {
    const prev = this.senders.get(e.senderFp);
    const doc: SenderDoc = prev ?? {
      _id: e.senderFp,
      strikes: 0,
      maxScore: 0,
      categories: [],
      models: [],
      firstSeen: now,
      lastSeen: now,
      blockedUntil: null,
      allowlisted: false,
    };
    doc.strikes += 1;
    doc.maxScore = Math.max(doc.maxScore, e.score);
    if (e.category && !doc.categories.includes(e.category)) doc.categories.push(e.category);
    if (!doc.models.includes(e.model)) doc.models.push(e.model);
    doc.lastSeen = now;
    doc.blockedUntil = nextBlockedUntil(doc, e.score, this.rules, now);
    this.senders.set(e.senderFp, doc);

    const t = this.texts.get(e.textFp) ?? { _id: e.textFp, hits: 0, maxScore: 0, senders: [], firstSeen: now, lastSeen: now };
    t.hits += 1;
    t.maxScore = Math.max(t.maxScore, e.score);
    if (!t.senders.includes(e.senderFp)) t.senders.push(e.senderFp);
    t.lastSeen = now;
    this.texts.set(e.textFp, t);

    return { strikes: doc.strikes, blocked: isActive(doc, now), blockedUntil: doc.blockedUntil };
  }

  async allow(senderFp: string, now = new Date()): Promise<void> {
    const doc = this.senders.get(senderFp);
    if (doc) {
      doc.allowlisted = true;
      doc.blockedUntil = null;
      doc.lastSeen = now;
    } else {
      this.senders.set(senderFp, {
        _id: senderFp, strikes: 0, maxScore: 0, categories: [], models: [],
        firstSeen: now, lastSeen: now, blockedUntil: null, allowlisted: true,
      });
    }
  }

  async clear(): Promise<number> {
    const n = this.senders.size;
    this.senders.clear();
    return n;
  }

  async countBlocked(now = new Date()): Promise<number> {
    let n = 0;
    for (const doc of this.senders.values()) if (isActive(doc, now)) n += 1;
    return n;
  }

  async close(): Promise<void> {}
}

export interface MongoBlocklistOptions {
  uri: string;
  dbName: string;
  rules: BlocklistRules;
  /** Upper bound for any one Atlas call, so Atlas can never hold up a decision for long. */
  timeoutMs?: number;
}

/** MongoDB Atlas blocklist. Collections: `senders` and `scam_texts`. */
export class MongoBlocklist implements Blocklist {
  private readonly client: MongoClient;
  private readonly senders: Collection<SenderDoc>;
  private readonly texts: Collection<ScamTextDoc>;
  private readonly rules: BlocklistRules;

  constructor({ uri, dbName, rules, timeoutMs = 2000 }: MongoBlocklistOptions) {
    this.client = new MongoClient(uri, {
      appName: 't-gate-gateway',
      serverSelectionTimeoutMS: timeoutMs,
      connectTimeoutMS: timeoutMs,
      socketTimeoutMS: timeoutMs * 2,
    });
    const db = this.client.db(dbName);
    this.senders = db.collection<SenderDoc>('senders');
    this.texts = db.collection<ScamTextDoc>('scam_texts');
    this.rules = rules;
  }

  async isBlocked(senderFp: string, now = new Date()): Promise<boolean> {
    const doc = await this.senders.findOne(
      { _id: senderFp, allowlisted: { $ne: true }, blockedUntil: { $gt: now } },
      { projection: { _id: 1 } },
    );
    return doc !== null;
  }

  async recordScam(e: ScamEvent, now = new Date()): Promise<RecordResult> {
    const doc = await this.senders.findOneAndUpdate(
      { _id: e.senderFp },
      {
        $inc: { strikes: 1 },
        $max: { maxScore: e.score },
        $addToSet: { models: e.model, ...(e.category ? { categories: e.category } : {}) },
        $set: { lastSeen: now },
        $setOnInsert: { firstSeen: now, blockedUntil: null, allowlisted: false, ...(e.category ? {} : { categories: [] }) },
      },
      { upsert: true, returnDocument: 'after' },
    );
    if (!doc) throw new Error('findOneAndUpdate returned no document');

    let blockedUntil = doc.blockedUntil;
    const next = nextBlockedUntil(doc, e.score, this.rules, now);
    if (next && next !== doc.blockedUntil) {
      await this.senders.updateOne({ _id: e.senderFp, allowlisted: { $ne: true } }, { $set: { blockedUntil: next } });
      blockedUntil = next;
    }

    await this.texts.updateOne(
      { _id: e.textFp },
      {
        $inc: { hits: 1 },
        $max: { maxScore: e.score },
        $addToSet: { senders: e.senderFp },
        $set: { lastSeen: now },
        $setOnInsert: { firstSeen: now },
      },
      { upsert: true },
    );

    const blocked = isActive({ allowlisted: doc.allowlisted, blockedUntil }, now);
    return { strikes: doc.strikes, blocked, blockedUntil };
  }

  async allow(senderFp: string, now = new Date()): Promise<void> {
    await this.senders.updateOne(
      { _id: senderFp },
      {
        $set: { allowlisted: true, blockedUntil: null, lastSeen: now },
        $setOnInsert: { strikes: 0, maxScore: 0, categories: [], models: [], firstSeen: now },
      },
      { upsert: true },
    );
  }

  async clear(): Promise<number> {
    const res = await this.senders.deleteMany({});
    return res.deletedCount;
  }

  async countBlocked(now = new Date()): Promise<number> {
    return this.senders.countDocuments({ allowlisted: { $ne: true }, blockedUntil: { $gt: now } });
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
