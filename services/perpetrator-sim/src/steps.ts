import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mulberry32, shuffle } from "./rng.ts";

export type Expected = "deliver" | "block";

/** One message to send. `expected` is printed for checking only; it is never sent to the gateway. */
export interface Step {
  delayMs: number;
  from: string;
  body: string;
  expected?: Expected;
}

export interface BankRow {
  id: string;
  text: string;
  expected_label: "scam" | "legit";
  category: string | null;
  source: string;
  source_id: string | null;
}

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "../../..");
export const MESSAGE_BANK_DIR = join(REPO_ROOT, "data/message_bank");
export const SCENARIO_DIR = join(MESSAGE_BANK_DIR, "scenarios");
export const BANK_FILES = [join(MESSAGE_BANK_DIR, "bank.jsonl"), join(MESSAGE_BANK_DIR, "generated.jsonl")];

export function parseJsonl<T = unknown>(text: string, label = "jsonl"): T[] {
  const rows: T[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    try {
      rows.push(JSON.parse(line) as T);
    } catch (err) {
      throw new Error(`${label}:${i + 1}: invalid JSON (${(err as Error).message})`);
    }
  });
  return rows;
}

export function parseScenario(text: string, label = "scenario"): Step[] {
  return parseJsonl<Record<string, unknown>>(text, label).map((row, i) => {
    const where = `${label} step ${i + 1}`;
    const { delayMs, from, body, expected } = row;
    if (typeof delayMs !== "number" || !Number.isFinite(delayMs) || delayMs < 0) {
      throw new Error(`${where}: delayMs must be a non-negative number`);
    }
    if (typeof from !== "string" || !from) throw new Error(`${where}: from must be a string`);
    if (typeof body !== "string" || !body) throw new Error(`${where}: body must be a non-empty string`);
    if (expected !== undefined && expected !== "deliver" && expected !== "block") {
      throw new Error(`${where}: expected must be "deliver" or "block"`);
    }
    return { delayMs, from, body, expected };
  });
}

/** Use the path as given if it exists; otherwise look in data/message_bank/scenarios/ (with or without .jsonl). */
export function resolveScenarioPath(file: string): string {
  if (existsSync(file)) return resolve(file);
  if (!isAbsolute(file)) {
    for (const candidate of [join(SCENARIO_DIR, file), join(SCENARIO_DIR, `${file}.jsonl`)]) {
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error(`scenario file not found: ${file} (also looked in ${SCENARIO_DIR})`);
}

export function loadScenario(file: string): Step[] {
  const path = resolveScenarioPath(file);
  return parseScenario(readFileSync(path, "utf8"), path);
}

export function loadBank(files: readonly string[] = BANK_FILES): BankRow[] {
  return files.flatMap((f) => parseJsonl<BankRow>(readFileSync(f, "utf8"), f));
}

export interface RandomOptions {
  n: number;
  scamRatio: number;
  seed: number;
  intervalMs: number;
}

/**
 * Fictional sender pool for random mode: +15555550120..+15555550199, minus the numbers the
 * grandparent scenario uses as recurring characters (0142 "Grandson", 0177 "Bank").
 */
export const RANDOM_SENDERS: readonly string[] = Array.from({ length: 80 }, (_, i) => `+155555501${20 + i}`).filter(
  (n) => n !== "+15555550142" && n !== "+15555550177",
);

/**
 * Draw `n` messages: round(n * scamRatio) scams and the rest legit, shuffled with the seed.
 * Draws without replacement until a pool runs out, then wraps around.
 */
export function randomSteps(bank: readonly BankRow[], opts: RandomOptions): Step[] {
  if (!Number.isInteger(opts.n) || opts.n < 1) throw new Error("--n must be a positive integer");
  if (!(opts.scamRatio >= 0 && opts.scamRatio <= 1)) throw new Error("--scam-ratio must be between 0 and 1");
  const rand = mulberry32(opts.seed);
  const scams = shuffle(bank.filter((r) => r.expected_label === "scam"), rand);
  const legit = shuffle(bank.filter((r) => r.expected_label === "legit"), rand);
  const nScam = Math.round(opts.n * opts.scamRatio);
  if (nScam > 0 && scams.length === 0) throw new Error("message bank has no scam rows");
  if (opts.n - nScam > 0 && legit.length === 0) throw new Error("message bank has no legit rows");
  const picked = [
    ...Array.from({ length: nScam }, (_, i) => scams[i % scams.length]!),
    ...Array.from({ length: opts.n - nScam }, (_, i) => legit[i % legit.length]!),
  ];
  const senders = shuffle(RANDOM_SENDERS, rand);
  return shuffle(picked, rand).map((row, i) => ({
    delayMs: i === 0 ? 0 : opts.intervalMs,
    from: senders[i % senders.length]!,
    body: row.text,
    expected: row.expected_label === "scam" ? "block" : "deliver",
  }));
}
