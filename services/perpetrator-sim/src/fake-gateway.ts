/**
 * A tiny stand-in for the gateway, for testing the simulator alone.
 * Verifies X-Twilio-Signature with twilio.validateRequest, logs each message,
 * and returns empty TwiML (403 on a bad signature). No classification.
 *
 *   npm run fake-gateway            # listens on the port in GATEWAY_WEBHOOK_URL (default 8787)
 */
import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import twilio from "twilio";
import { configFromEnv, loadDotEnv } from "./config.ts";
import { maskNumber } from "./twilio-request.ts";

export interface ReceivedMessage {
  params: Record<string, string>;
  signature: string;
  valid: boolean;
}

/** `webhookUrl` is the public URL the signature must be computed against (as the real gateway is configured). */
export function startFakeGateway(opts: {
  webhookUrl: string;
  authToken: string;
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
      const params = Object.fromEntries(new URLSearchParams(raw));
      const signature = String(req.headers["x-twilio-signature"] ?? "");
      const valid = twilio.validateRequest(opts.authToken, signature, opts.webhookUrl, params);
      received.push({ params, signature, valid });
      opts.log?.(
        `${valid ? "valid  " : "INVALID"} ${params.MessageSid} from ${maskNumber(params.From ?? "")}: ${params.Body}`,
      );
      if (!valid) {
        res.writeHead(403, { "Content-Type": "text/plain" }).end("invalid signature");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/xml" }).end("<Response></Response>");
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
  startFakeGateway({ webhookUrl: config.webhookUrl, authToken: config.authToken, port, log: console.log }).then(() =>
    console.log(`fake gateway listening on 127.0.0.1:${port}, verifying against ${config.webhookUrl}`),
  );
}
