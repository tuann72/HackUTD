import { serve } from '@hono/node-server';
import { WEBHOOK_PATH, createApp } from './app.js';
import { HttpClassifier, StubClassifier, type Classifier } from './classifier.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';

const config = loadConfig();
const db = openDb(config.dbPath);

const classifier: Classifier = config.classifierUrl
  ? new HttpClassifier({ baseUrl: config.classifierUrl, token: config.classifierToken, timeoutMs: config.classifierTimeoutMs })
  : new StubClassifier();

const app = createApp({ db, classifier, config });

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[gateway] listening on http://localhost:${info.port}`);
  console.log(`[gateway] db=${config.dbPath} classifier=${config.classifierUrl ? `http (${config.classifierUrl})` : 'stub'} threshold=${config.blockThreshold}`);
  console.log(`[gateway] Photon webhook: POST ${WEBHOOK_PATH} (signature tolerance ${config.signatureToleranceSeconds}s) debug=${config.debug ? 'ON' : 'off'}`);
});

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  server.close(async () => {
    await app.idle();
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
