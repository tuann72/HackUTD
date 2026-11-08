import { setServers } from 'node:dns';
import { serve } from '@hono/node-server';
import { WEBHOOK_PATH, createApp } from './app.js';
import { MemoryBlocklist, MongoBlocklist, ephemeralSecret, makeFingerprinter, type Blocklist } from './blocklist.js';
import { HttpClassifier, StubClassifier, type Classifier } from './classifier.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { MockBank, NessieBank } from './bank.js';
import { NemotronReviewer, type Reviewer } from './reviewer.js';

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
// SENDER_BLOCKLIST=on (default since 2026-11-08, Tuan): Atlas if MONGODB_URI is set, else an in-process
// blocklist and per-process key (both reset on restart). off: no blocklist object, no Atlas connection.
let blocklist: Blocklist | undefined;
if (config.senderBlocklist) {
  blocklist = config.mongodbUri
    ? new MongoBlocklist({ uri: config.mongodbUri, dbName: config.mongodbDb, rules })
    : new MemoryBlocklist(rules);
} else if (config.mongodbUri) {
  console.warn('[gateway] MONGODB_URI is set but SENDER_BLOCKLIST=off: ignored, not connecting to Atlas');
}
const fingerprinter = blocklist ? makeFingerprinter(config.fingerprintSecret ?? ephemeralSecret()) : undefined;

// A missing key turns the review off rather than stopping the gateway: interception matters more.
let reviewer: Reviewer | undefined;
if (config.reviewer && !config.nvidiaApiKey) {
  console.warn('[gateway] REVIEWER=on but NVIDIA_API_KEY is empty: review is off');
} else if (config.reviewer && config.nvidiaApiKey) {
  const fallbackBank = new MockBank();
  reviewer = new NemotronReviewer({
    apiKey: config.nvidiaApiKey,
    model: config.nemotronModel,
    baseUrl: config.nvidiaBaseUrl,
    timeoutMs: config.reviewTimeoutMs,
    fallbackBank,
    bank:
      config.nessieApiKey && config.nessieAccountId
        ? new NessieBank({ baseUrl: config.nessieBaseUrl, apiKey: config.nessieApiKey, accountId: config.nessieAccountId })
        : fallbackBank,
  });
}

const app = createApp({ db, classifier, config, blocklist, fingerprinter, reviewer });

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[gateway] listening on http://localhost:${info.port}`);
  console.log(`[gateway] db=${config.dbPath} classifier=${config.classifierUrl ? `http (${config.classifierUrl})` : 'stub'} threshold=${config.blockThreshold}`);
  console.log(
    `[gateway] sender blocklist=${!blocklist ? 'off (each message judged on its own)' : `on, ${config.mongodbUri ? `atlas (${config.mongodbDb})` : 'memory (resets on restart)'}, strikes=${rules.strikes} score>=${rules.highScore} ttl=${config.senderBlockTtlDays}d`} admin=${config.adminToken ? 'ON' : 'off'}`,
  );
  console.log(`[gateway] review=${reviewer ? `on (${config.nemotronModel}, band ${config.reviewBandLow}-${config.reviewBandHigh})` : 'off'}`);
  console.log(`[gateway] voice score=${config.voiceScoreToken ? `on (POST /voice/score, warn threshold ${config.voiceWarnThreshold})` : 'off'}`);
  if (config.dnsServers.length > 0) console.log(`[gateway] dns=${config.dnsServers.join(',')}`);
  console.log(`[gateway] Photon webhook: POST ${WEBHOOK_PATH} (signature tolerance ${config.signatureToleranceSeconds}s) debug=${config.debug ? 'ON' : 'off'}`);
});

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  server.close(async () => {
    await app.idle();
    await blocklist?.close().catch(() => {});
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
