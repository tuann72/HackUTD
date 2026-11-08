import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  MemoryBlocklist,
  MongoBlocklist,
  makeFingerprinter,
  normalizeNumber,
  normalizeText,
  type Blocklist,
  type BlocklistRules,
} from '../src/blocklist.js';
import { loadConfig } from '../src/config.js';

const SECRET = 'a'.repeat(64);
const RULES: BlocklistRules = { strikes: 3, highScore: 0.95, ttlMs: 7 * 24 * 3600 * 1000 };
const DAY = 24 * 3600 * 1000;
const T0 = new Date('2026-11-08T12:00:00Z');
const at = (days: number) => new Date(T0.getTime() + days * DAY);

describe('fingerprints', () => {
  const fp = makeFingerprinter(SECRET);

  it('hashes the same number the same way, whatever the formatting', () => {
    expect(normalizeNumber(' +1 (555) 555-0142 ')).toBe('+15555550142');
    expect(fp.sender('+1 (555) 555-0142')).toBe(fp.sender('+15555550142'));
    expect(fp.sender('+15555550142')).not.toBe(fp.sender('+15555550143'));
  });

  it('depends on the secret, and never contains the raw value', () => {
    const other = makeFingerprinter('b'.repeat(64));
    expect(other.sender('+15555550142')).not.toBe(fp.sender('+15555550142'));
    const h = fp.sender('+15555550142');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('5555550142');
  });

  it('keeps sender and text hashes apart for the same string', () => {
    expect(fp.sender('15555550142')).not.toBe(fp.text('15555550142'));
  });

  it('matches small variations of one scam text', () => {
    const a = 'Your account is LOCKED.  Verify at https://bit.ly/abc123 within 24 hours';
    const b = 'your account is locked. verify at bit.ly/zzz9 within 12 hours';
    expect(normalizeText(a)).toBe('your account is locked. verify at <url> within <n> hours');
    expect(fp.text(a)).toBe(fp.text(b));
    expect(fp.text(a)).not.toBe(fp.text('Dinner Sunday still on?'));
  });

  it('refuses an empty secret', () => {
    expect(() => makeFingerprinter('')).toThrow();
  });
});

function blocklistContract(name: string, make: () => Blocklist | null) {
  const bl = make();
  describe.skipIf(!bl)(name, () => {
    const list = bl as Blocklist;
    const fp = makeFingerprinter(SECRET);
    // Unique senders per run, so a shared Atlas test database never leaks state between runs.
    const run = randomBytes(4).toString('hex');
    const sender = (n: number) => fp.sender(`+1555${run}${n}`);
    const scam = (senderFp: string, score = 0.8) => ({
      senderFp, textFp: fp.text(`scam ${run}`), score, category: 'Imposter & Phishing', model: 'test@1',
    });

    afterAll(() => list.close());

    it('blocklists a sender only after the third scam', async () => {
      const s = sender(1);
      expect(await list.isBlocked(s, at(0))).toBe(false);
      expect((await list.recordScam(scam(s), at(0))).blocked).toBe(false);
      expect((await list.recordScam(scam(s), at(0))).blocked).toBe(false);
      expect(await list.isBlocked(s, at(0))).toBe(false);
      const third = await list.recordScam(scam(s), at(0));
      expect(third).toMatchObject({ strikes: 3, blocked: true });
      expect(await list.isBlocked(s, at(1))).toBe(true);
    });

    it('blocklists at once on one very high score', async () => {
      const s = sender(2);
      expect((await list.recordScam(scam(s, 0.97), at(0))).blocked).toBe(true);
      expect(await list.isBlocked(s, at(0))).toBe(true);
    });

    it('lets a block expire', async () => {
      const s = sender(3);
      await list.recordScam(scam(s, 0.99), at(0));
      expect(await list.isBlocked(s, at(6.9))).toBe(true);
      expect(await list.isBlocked(s, at(7.1))).toBe(false);
    });

    it('"Not a scam" lifts the block and the sender is never blocklisted again', async () => {
      const s = sender(4);
      await list.recordScam(scam(s, 0.99), at(0));
      await list.allow(s, at(1));
      expect(await list.isBlocked(s, at(1))).toBe(false);
      const again = await list.recordScam(scam(s, 0.99), at(2));
      expect(again.blocked).toBe(false);
      expect(await list.isBlocked(s, at(2))).toBe(false);
    });

    it('allowlists a sender it has never seen', async () => {
      const s = sender(5);
      await list.allow(s, at(0));
      expect((await list.recordScam(scam(s, 0.99), at(0))).blocked).toBe(false);
    });
  });
}

blocklistContract('MemoryBlocklist', () => new MemoryBlocklist(RULES));

// Runs against a real cluster only when MONGODB_TEST_URI is set, e.g. a throwaway Atlas database:
//   MONGODB_TEST_URI='mongodb+srv://...' npx vitest run test/blocklist.test.ts
const testUri = process.env.MONGODB_TEST_URI;
blocklistContract('MongoBlocklist (MONGODB_TEST_URI)', () =>
  testUri ? new MongoBlocklist({ uri: testUri, dbName: 'tgate_test', rules: RULES, timeoutMs: 10_000 }) : null,
);

describe('MemoryBlocklist storage', () => {
  it('stores no raw number or text', async () => {
    const list = new MemoryBlocklist(RULES);
    const fp = makeFingerprinter(SECRET);
    const phone = '+15555550142';
    const body = 'Your account is locked, verify now';
    await list.recordScam({ senderFp: fp.sender(phone), textFp: fp.text(body), score: 0.9, category: null, model: 'test@1' });
    const dump = JSON.stringify([...list.senders.values(), ...list.texts.values()]);
    expect(dump).not.toContain('5555550142');
    expect(dump).not.toContain('verify now');
  });
});

describe('blocklist config', () => {
  const base = { PHOTON_WEBHOOK_SECRET: 't' };

  it('defaults to 3 strikes, 0.95, 7 days, no Atlas', () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({ mongodbUri: null, mongodbDb: 'tgate', senderBlockStrikes: 3, senderBlockScore: 0.95, senderBlockTtlDays: 7 });
  });

  it('requires a long FINGERPRINT_SECRET with MONGODB_URI', () => {
    expect(() => loadConfig({ ...base, MONGODB_URI: 'mongodb+srv://x' })).toThrow(/FINGERPRINT_SECRET/);
    expect(() => loadConfig({ ...base, MONGODB_URI: 'mongodb+srv://x', FINGERPRINT_SECRET: 'short' })).toThrow(/32/);
    expect(loadConfig({ ...base, MONGODB_URI: 'mongodb+srv://x', FINGERPRINT_SECRET: SECRET }).fingerprintSecret).toBe(SECRET);
  });

  it('rejects bad rule values', () => {
    expect(() => loadConfig({ ...base, SENDER_BLOCK_STRIKES: '0' })).toThrow();
    expect(() => loadConfig({ ...base, SENDER_BLOCK_SCORE: '1.5' })).toThrow();
    expect(() => loadConfig({ ...base, SENDER_BLOCK_TTL_DAYS: '-1' })).toThrow();
  });
});
