import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeClassifierOptions {
  delayMs?: number;
  status?: number;
  respond?: (req: { messageId: string; text: string }) => unknown;
}

export async function startFakeClassifier(opts: FakeClassifierOptions = {}) {
  const requests: Array<{ path: string; headers: IncomingHttpHeaders; body: unknown }> = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      requests.push({ path: req.url ?? '', headers: req.headers, body });
      const send = () => {
        if (res.destroyed) return;
        const payload = opts.respond
          ? opts.respond(body)
          : { messageId: body.messageId, label: 'legit', score: 0.1, category: null, model: 'fake@1', highlights: [] };
        res.writeHead(opts.status ?? 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      opts.delayMs ? setTimeout(send, opts.delayMs) : send();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
