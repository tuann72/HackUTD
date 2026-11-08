// The simulation panel's buttons. Edit this list to add, remove or retune them;
// the panel renders whatever is here. Scenario ids are file names (without
// .jsonl) in data/message_bank/scenarios/, copied by `npm run sync:bank`.

export type Preset =
  | {
      kind: "scenario";
      id: string;
      label: string;
      description: string;
      scenario: string;
    }
  | {
      kind: "random";
      id: string;
      label: string;
      description: string;
      /** Messages to send. */
      n: number;
      /** Share of scams, 0 to 1. */
      scamRatio: number;
      /** ms between messages. */
      intervalMs: number;
    };

export const PRESETS: Preset[] = [
  { kind: "random", id: "one-scam", label: "Send a scam", description: "One potential scam from the bank", n: 1, scamRatio: 1, intervalMs: 0 },
  { kind: "random", id: "one-legit", label: "Send a legit text", description: "One ordinary message from the bank", n: 1, scamRatio: 0, intervalMs: 0 },
  { kind: "random", id: "burst", label: "Random burst", description: "Mixed messages from the bank", n: 10, scamRatio: 0.6, intervalMs: 1500 },
  { kind: "random", id: "rapid", label: "Rapid fire", description: "50 mixed messages, 100 ms apart", n: 50, scamRatio: 0.6, intervalMs: 100 },
];

/** Limits the panel's settings enforce, so a stray value can't flood the gateway. */
export const LIMITS = { maxN: 50, minIntervalMs: 100, maxIntervalMs: 30_000 };
