import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { Action, ApiMessage, Reason, Verdict } from './types.js';

// Raw phone numbers and Twilio SIDs are stored here and nowhere else.
// Nothing in this module returns them to callers outside the DB layer.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS participants (
  id          TEXT PRIMARY KEY,
  phone       TEXT NOT NULL UNIQUE,
  display     TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  id              TEXT NOT NULL UNIQUE,
  message_sid     TEXT NOT NULL UNIQUE,
  participant_id  TEXT NOT NULL REFERENCES participants(id),
  to_number       TEXT,
  body            TEXT NOT NULL,
  received_at     TEXT NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('pending', 'delivered', 'blocked')),
  reason          TEXT CHECK (reason IN ('model_verdict', 'classifier_unavailable')),
  verdict_json    TEXT,
  classified_at   TEXT
);
`;

export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

/** `+15555550142` -> `***-***-0142`. */
export function maskNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 0) return '***-***-****';
  return `***-***-${digits.slice(-4).padStart(4, '*')}`;
}

export interface InboundRecord {
  messageSid: string;
  from: string;
  to: string | null;
  body: string;
}

export interface StoredMessage {
  id: string;
  body: string;
  display: string;
}

export class Store {
  constructor(private readonly db: DatabaseSync) {}

  /** Returns the participant id for a phone number, creating one on first sight. */
  private participantFor(phone: string, now: string): { id: string; display: string } {
    const existing = this.db
      .prepare('SELECT id, display FROM participants WHERE phone = ?')
      .get(phone) as { id: string; display: string } | undefined;
    if (existing) return existing;
    const p = { id: newId('p'), display: maskNumber(phone) };
    this.db
      .prepare('INSERT INTO participants (id, phone, display, created_at) VALUES (?, ?, ?, ?)')
      .run(p.id, phone, p.display, now);
    return p;
  }

  /**
   * Inserts a new pending message. Returns null if this MessageSid was already seen (Twilio retry).
   */
  insertInbound(rec: InboundRecord, now = new Date()): StoredMessage | null {
    const nowIso = now.toISOString();
    const seen = this.db.prepare('SELECT 1 FROM messages WHERE message_sid = ?').get(rec.messageSid);
    if (seen) return null;
    this.db.exec('BEGIN');
    try {
      const p = this.participantFor(rec.from, nowIso);
      const id = newId('msg');
      const res = this.db
        .prepare(
          `INSERT OR IGNORE INTO messages (id, message_sid, participant_id, to_number, body, received_at, action)
           VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
        )
        .run(id, rec.messageSid, p.id, rec.to, rec.body, nowIso);
      this.db.exec('COMMIT');
      if (Number(res.changes) === 0) return null;
      return { id, body: rec.body, display: p.display };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  applyDecision(id: string, action: Exclude<Action, 'pending'>, reason: Exclude<Reason, null>, verdict: Verdict | null, now = new Date()): void {
    this.db
      .prepare('UPDATE messages SET action = ?, reason = ?, verdict_json = ?, classified_at = ? WHERE id = ?')
      .run(action, reason, verdict ? JSON.stringify(verdict) : null, now.toISOString(), id);
  }

  listMessages(limit: number): ApiMessage[] {
    const rows = this.db
      .prepare(
        `SELECT m.id, m.participant_id, p.display, m.body, m.received_at, m.action, m.reason, m.verdict_json
         FROM messages m JOIN participants p ON p.id = m.participant_id
         ORDER BY m.seq DESC LIMIT ?`,
      )
      .all(limit) as Array<{
      id: string;
      participant_id: string;
      display: string;
      body: string;
      received_at: string;
      action: Action;
      reason: Reason;
      verdict_json: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      from: { participantId: r.participant_id, display: r.display },
      body: r.body,
      receivedAt: r.received_at,
      action: r.action,
      reason: r.reason ?? null,
      verdict: r.verdict_json ? (JSON.parse(r.verdict_json) as Verdict) : null,
    }));
  }

  count(): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n);
  }

  /** Debug only: wipe everything. */
  reset(): void {
    this.db.exec('BEGIN; DELETE FROM messages; DELETE FROM participants; DELETE FROM sqlite_sequence; COMMIT;');
  }
}
