/**
 * A tiny stand-in for the gateway, for testing the simulator alone.
 * Verifies X-Spectrum-Signature and the timestamp window, logs each message,
 * and returns 200 ok (400/401 on a bad request, like the gateway). No classification.
 *
 *   npm run fake-gateway            # listens on the port in GATEWAY_WEBHOOK_URL (default 8787)
 */
import { timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import { configFromEnv, loadDotEnv } from "./config.ts";
import { maskNumber, signBody, type SpectrumPayload } from "./spectrum-request.ts";

export interface ReceivedMessage {
  payload: SpectrumPayload | null;
  raw: string;
  signature: string;
  timestamp: string;
  valid: boolean;
}

export function verify(secret: string, signature: string, timestamp: string, raw: string, nowS = Date.now() / 1000): boolean {
  if (!signature || !/^\d+$/.test(timestamp) || Math.abs(nowS - Number(timestamp)) > 300) return false;
  const a = Buffer.from(signBody(secret, timestamp, raw));
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function startFakeGateway(opts: {
  webhookUrl: string;
  webhookSecret: string;
  port?: number;
  log?: (line: string) => void;
}): Promise<{ server: Server; port: number; received: ReceivedMessage[]; close: () => Promise<void> }> {
  const received: ReceivedMessage[] = [];
  const path = new URL(opts.webhookUrl).pathname;
  const server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== path) {
      res.writeHead(404).end();
      return;
    }
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const signature = String(req.headers["x-spectrum-signature"] ?? "");
      const timestamp = String(req.headers["x-spectrum-timestamp"] ?? "");
      const valid = verify(opts.webhookSecret, signature, timestamp, raw);
      let payload: SpectrumPayload | null = null;
      try {
        payload = JSON.parse(raw) as SpectrumPayload;
      } catch {
        /* recorded as null */
      }
      received.push({ payload, raw, signature, timestamp, valid });
      const m = payload?.message;
      opts.log?.(`${valid ? "valid  " : "INVALID"} ${m?.id} from ${maskNumber(m?.sender.id ?? "")}: ${m?.content.text}`);
      if (!valid) {
        res.writeHead(401, { "Content-Type": "text/plain" }).end("bad signature");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    });
  });
  return new Promise((resolve) => {
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        server,
        port,
        received,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadDotEnv();
  const config = configFromEnv();
  const port = Number(new URL(config.webhookUrl).port || 80);
  startFakeGateway({ webhookUrl: config.webhookUrl, webhookSecret: config.webhookSecret, port, log: console.log }).then(() =>
    console.log(`fake gateway listening on 127.0.0.1:${port} for ${new URL(config.webhookUrl).pathname}`),
  );
}
