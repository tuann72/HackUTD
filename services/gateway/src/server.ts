import { setServers } from 'node:dns';
import { serve } from '@hono/node-server';
import { WEBHOOK_PATH, createApp } from './app.js';
import { MemoryBlocklist, MongoBlocklist, ephemeralSecret, makeFingerprinter, type Blocklist } from './blocklist.js';
import { HttpClassifier, StubClassifier, type Classifier } from './classifier.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';

const config = loadConfig();
// Some machines hand Node a DNS server that doesn't answer SRV lookups, so `mongodb+srv://` fails
// with `querySrv ECONNREFUSED` even though the OS resolves it. DNS_SERVERS overrides Node's resolver.
if (config.dnsServers.length > 0) setServers(config.dnsServers);
const db = openDb(config.dbPath);

const classifier: Classifier = config.classifierUrl
  ? new HttpClassifier({ baseUrl: config.classifierUrl, token: config.classifierToken, timeoutMs: config.classifierTimeoutMs })
  : new StubClassifier();

const rules = {
  strikes: config.senderBlockStrikes,
  highScore: config.senderBlockScore,
  ttlMs: config.senderBlockTtlDays * 24 * 60 * 60 * 1000,
};
// Without Atlas, an in-process blocklist and a per-process key: both reset on restart.
const blocklist: Blocklist = config.mongodbUri
  ? new MongoBlocklist({ uri: config.mongodbUri, dbName: config.mongodbDb, rules })
  : new MemoryBlocklist(rules);
const fingerprinter = makeFingerprinter(config.fingerprintSecret ?? ephemeralSecret());

const app = createApp({ db, classifier, config, blocklist, fingerprinter });

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[gateway] listening on http://localhost:${info.port}`);
  console.log(`[gateway] db=${config.dbPath} classifier=${config.classifierUrl ? `http (${config.classifierUrl})` : 'stub'} threshold=${config.blockThreshold}`);
  console.log(
    `[gateway] blocklist=${config.mongodbUri ? `atlas (${config.mongodbDb})` : 'memory (resets on restart)'} strikes=${rules.strikes} score>=${rules.highScore} ttl=${config.senderBlockTtlDays}d admin=${config.adminToken ? 'ON' : 'off'}`,
  );
  if (config.dnsServers.length > 0) console.log(`[gateway] dns=${config.dnsServers.join(',')}`);
  console.log(`[gateway] Photon webhook: POST ${WEBHOOK_PATH} (signature tolerance ${config.signatureToleranceSeconds}s) debug=${config.debug ? 'ON' : 'off'}`);
});

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  server.close(async () => {
    await app.idle();
    await blocklist.close().catch(() => {});
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
