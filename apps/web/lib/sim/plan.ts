// Turns a preset and the panel's settings into the steps a run sends. Pure and
// browser-safe: no secrets here, the server route signs each step.
import bank from "./bank.json";
import { LIMITS, type Preset } from "./presets";

/** Non-text iMessage content, as data/message_bank/README.md describes it. */
export type SimContent =
  | { type: "text"; text: string }
  | { type: "richlink"; url: string }
  | { type: "attachment"; name: string; mimeType: string; size?: number }
  | { type: "reaction"; emoji: string; targetPreview?: string }
  | { type: "contact"; name?: string; phones?: string[] }
  | { type: "group"; items: SimContent[] };

export interface Step {
  /** ms to wait before sending this step. */
  delayMs: number;
  from: string;
  body?: string;
  content?: SimContent;
  group?: string;
  /** For the panel's log only; never sent to the gateway. */
  expected?: "deliver" | "block";
}

interface BankRow {
  id: string;
  text: string;
  label: "scam" | "legit";
  category: string | null;
}

const ROWS = (bank as { rows: BankRow[] }).rows;
/** Rapid fire's dataset: 200 complete sentences, 40% scam (data/message_bank/rapid.jsonl). */
export const RAPID_ROWS = (bank as { rapid: BankRow[] }).rapid;
const SCENARIOS = (bank as unknown as { scenarios: Record<string, Step[]> }).scenarios;

export const SCENARIO_IDS = Object.keys(SCENARIOS);

export interface RunSettings {
  n: number;
  scamRatio: number;
  intervalMs: number;
  /** Fixed sender for random runs; empty = a random fictional number per message. */
  from: string;
  seed: number;
}

/** Fictional senders +15555550120–0199, skipping 0142 and 0177 (the scenarios use them), like the CLI. */
export const SENDER_POOL = Array.from({ length: 80 }, (_, i) => `+155555501${String(20 + i).padStart(2, "0")}`).filter(
  (n) => !n.endsWith("0142") && !n.endsWith("0177"),
);

export function isFictionalNumber(n: string): boolean {
  return /^\+1555\d{7}$/.test(n);
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

/** round(n × ratio) scams and the rest legit, shuffled with the seed. Rows repeat only if n exceeds the bank. */
export function randomSteps(s: RunSettings, rows: BankRow[] = ROWS): Step[] {
  const n = clamp(Math.round(s.n), 1, LIMITS.maxN);
  const ratio = clamp(s.scamRatio, 0, 1);
  const interval = n === 1 ? 0 : clamp(s.intervalMs, LIMITS.minIntervalMs, LIMITS.maxIntervalMs);
  const rand = mulberry32(s.seed);
  const draw = (label: "scam" | "legit", k: number) => {
    const pool = shuffle(rows.filter((r) => r.label === label), rand);
    return Array.from({ length: k }, (_, i) => pool[i % pool.length]!);
  };
  const scams = Math.round(n * ratio);
  const picked = shuffle([...draw("scam", scams), ...draw("legit", n - scams)], rand);
  return picked.map((row, i) => ({
    delayMs: i === 0 ? 0 : interval,
    from: s.from || SENDER_POOL[Math.floor(rand() * SENDER_POOL.length)]!,
    body: row.text,
    expected: row.label === "scam" ? "block" : "deliver",
  }));
}

export function scenarioSteps(id: string): Step[] {
  const steps = SCENARIOS[id];
  if (!steps) throw new Error(`unknown scenario ${JSON.stringify(id)}`);
  return steps.map((s) => ({ ...s }));
}

/**
 * The steps a preset button runs. Random presets use their own count, scam
 * ratio and interval (the panel no longer has settings for them); `s` supplies
 * the seed and sender.
 */
export function presetSteps(p: Preset, s: RunSettings): Step[] {
  if (p.kind === "scenario") return scenarioSteps(p.scenario);
  const rows = p.dataset === "rapid" ? RAPID_ROWS : ROWS;
  return randomSteps({ ...s, n: p.n, scamRatio: p.scamRatio, intervalMs: p.intervalMs }, rows);
}

/** Total wait of a run, for the panel's "about N s". */
export function runDurationMs(steps: Step[]): number {
  return steps.reduce((t, s) => t + s.delayMs, 0);
}
