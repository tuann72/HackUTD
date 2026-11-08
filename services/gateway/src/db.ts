import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { maskHandle, maskNumber, normalizeHandle } from './handle.js';
import type { InboundMessage } from './photon.js';
import type { Action, ApiMessage, Attachment, Conversation, MessageKind, Reason, Verdict } from './types.js';

// Raw iMessage handles (numbers or emails) and Photon message/space ids are stored here and
// nowhere else. Nothing in this module returns them to callers outside the DB layer.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS participants (
  id          TEXT PRIMARY KEY,
  handle      TEXT NOT NULL UNIQUE,
  display     TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  id          TEXT PRIMARY KEY,
  space_id    TEXT NOT NULL UNIQUE,
  type        TEXT NOT NULL CHECK (type IN ('dm', 'group')),
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  seq                  INTEGER PRIMARY KEY AUTOINCREMENT,
  id                   TEXT NOT NULL UNIQUE,
  provider_message_id  TEXT NOT NULL UNIQUE,
  participant_id       TEXT NOT NULL REFERENCES participants(id),
  conversation_id      TEXT NOT NULL REFERENCES conversations(id),
  line                 TEXT,
  sent_at              TEXT,
  kind                 TEXT NOT NULL CHECK (kind IN ('text', 'link', 'attachment', 'reaction', 'contact', 'album')),
  body                 TEXT NOT NULL,
  -- Masked extras for the API: attachments, reaction, contact.
  extras_json          TEXT NOT NULL,
  received_at          TEXT NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('pending', 'delivered', 'blocked')),
  reason          TEXT CHECK (reason IN ('model_verdict', 'classifier_unavailable', 'not_classified', 'sender_blocked', 'override')),
  verdict_json    TEXT,
  classified_at   TEXT
);
`;

export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const cols = (db.prepare("SELECT name FROM pragma_table_info('messages')").all() as Array<{ name: string }>).map((c) => c.name);
  const ddl = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'messages'").get() as { sql: string } | undefined)?.sql ?? '';
  if (cols.length > 0 && (!cols.includes('extras_json') || !ddl.includes("'override'"))) {
    db.close();
    throw new Error(`${path} uses an older schema (Twilio or early Photon). Delete it (npm run db:reset) and restart.`);
  }
  db.exec(SCHEMA);
  return db;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

export { maskHandle, maskNumber, normalizeHandle } from './handle.js';

interface Extras {
  attachments: Attachment[];
  reaction: ApiMessage['reaction'];
  contact: ApiMessage['contact'];
}

export interface StoredMessage {
  id: string;
  body: string;
  display: string;
}

export class Store {
  constructor(private readonly db: DatabaseSync) {}

  /** Returns the participant id for an iMessage handle, creating one on first sight. */
  private participantFor(rawHandle: string, now: string): { id: string; display: string } {
    const handle = normalizeHandle(rawHandle);
    const existing = this.db
      .prepare('SELECT id, display FROM participants WHERE handle = ?')
      .get(handle) as { id: string; display: string } | undefined;
    if (existing) return existing;
    const p = { id: newId('p'), display: maskHandle(handle) };
    this.db
      .prepare('INSERT INTO participants (id, handle, display, created_at) VALUES (?, ?, ?, ?)')
      .run(p.id, handle, p.display, now);
    return p;
  }

  private conversationFor(conv: InboundMessage['conversation'], now: string): string {
    const existing = this.db.prepare('SELECT id FROM conversations WHERE space_id = ?').get(conv.spaceId) as { id: string } | undefined;
    if (existing) return existing.id;
    const id = newId('c');
    this.db.prepare('INSERT INTO conversations (id, space_id, type, created_at) VALUES (?, ?, ?, ?)').run(id, conv.spaceId, conv.type, now);
    return id;
  }

  /**
   * Inserts a new pending message. Returns null if this Photon message.id was already seen
   * (Photon delivers at least once and retries on 5xx/timeouts).
   */
  insertInbound(rec: InboundMessage, now = new Date()): StoredMessage | null {
    const nowIso = now.toISOString();
    const seen = this.db.prepare('SELECT 1 FROM messages WHERE provider_message_id = ?').get(rec.providerMessageId);
    if (seen) return null;
    this.db.exec('BEGIN');
    try {
      const p = this.participantFor(rec.sender, nowIso);
      const conversationId = this.conversationFor(rec.conversation, nowIso);
      const extras: Extras = {
        attachments: rec.attachments,
        reaction: rec.reaction,
        // Phones on a shared contact card are third-party numbers: store them masked only.
        contact: rec.contact ? { name: rec.contact.name, phones: rec.contact.phones.map(maskNumber) } : null,
      };
      const id = newId('msg');
      const res = this.db
        .prepare(
          `INSERT OR IGNORE INTO messages
             (id, provider_message_id, participant_id, conversation_id, line, sent_at, kind, body, extras_json, received_at, action)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        )
        .run(id, rec.providerMessageId, p.id, conversationId, rec.line, rec.sentAt, rec.kind, rec.body, JSON.stringify(extras), nowIso);
      this.db.exec('COMMIT');
      if (Number(res.changes) === 0) return null;
      return { id, body: rec.body, display: p.display };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * Raw handle of a message's sender, for computing its fingerprint. Never return this to an API caller.
   * Null if the message doesn't exist.
   */
  senderHandleOf(id: string): string | null {
    const row = this.db
      .prepare('SELECT p.handle FROM messages m JOIN participants p ON p.id = m.participant_id WHERE m.id = ?')
      .get(id) as { handle: string } | undefined;
    return row?.handle ?? null;
  }

  /** Current action and reason of a message, or null if it doesn't exist. */
  decisionOf(id: string): { action: Action; reason: Reason } | null {
    const row = this.db.prepare('SELECT action, reason FROM messages WHERE id = ?').get(id) as { action: Action; reason: Reason } | undefined;
    return row ?? null;
  }

  /**
   * "Not a scam": move this message, and every other blocked message from the same sender,
   * to the inbox with reason `override`. Verdicts are kept for the record. Returns how many moved.
   */
  restoreSender(id: string, now = new Date()): number {
    const res = this.db
      .prepare(
        `UPDATE messages SET action = 'delivered', reason = 'override', classified_at = ?
         WHERE action = 'blocked' AND participant_id = (SELECT participant_id FROM messages WHERE id = ?)`,
      )
      .run(now.toISOString(), id);
    return Number(res.changes);
  }

  applyDecision(id: string, action: Exclude<Action, 'pending'>, reason: Exclude<Reason, null>, verdict: Verdict | null, now = new Date()): void {
    this.db
      .prepare('UPDATE messages SET action = ?, reason = ?, verdict_json = ?, classified_at = ? WHERE id = ?')
      .run(action, reason, verdict ? JSON.stringify(verdict) : null, now.toISOString(), id);
  }

  listMessages(limit: number): ApiMessage[] {
    const rows = this.db
      .prepare(
        `SELECT m.id, m.participant_id, p.display, m.body, m.received_at, m.action, m.reason, m.verdict_json,
                m.kind, m.extras_json, c.id AS conversation_id, c.type AS conversation_type
         FROM messages m
         JOIN participants p ON p.id = m.participant_id
         JOIN conversations c ON c.id = m.conversation_id
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
      kind: MessageKind;
      extras_json: string;
      conversation_id: string;
      conversation_type: Conversation['type'];
    }>;
    return rows.map((r) => {
      const extras = JSON.parse(r.extras_json) as Extras;
      return {
        id: r.id,
        from: { participantId: r.participant_id, display: r.display },
        body: r.body,
        receivedAt: r.received_at,
        action: r.action,
        reason: r.reason ?? null,
        verdict: r.verdict_json ? (JSON.parse(r.verdict_json) as Verdict) : null,
        kind: r.kind,
        conversation: { id: r.conversation_id, type: r.conversation_type },
        attachments: extras.attachments,
        reaction: extras.reaction,
        contact: extras.contact,
      };
    });
  }

  count(): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n);
  }

  /** Debug only: wipe everything. */
  reset(): void {
    this.db.exec('BEGIN; DELETE FROM messages; DELETE FROM conversations; DELETE FROM participants; DELETE FROM sqlite_sequence; COMMIT;');
  }
}
