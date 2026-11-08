import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { configFromEnv, loadDotEnv, type SimConfig } from "./config.ts";
import { guessMimeType, type SimContent } from "./content.ts";
import { runSteps, type RunOptions, type SendResult } from "./sender.ts";
import { loadBank, loadScenario, randomSteps, type Step } from "./steps.ts";

const USAGE = `Usage: npm run sim -- <command> [options]

Commands:
  scenario <file>                  Play a scenario JSONL (looked up in data/message_bank/scenarios/ if not found)
  random [--n 20] [--scam-ratio 0.6] [--seed N] [--interval-ms 1500]
                                   Draw messages from data/message_bank/{bank,generated}.jsonl
  send --from <+1555...> "<text>"  Send one typed message
       [--group <id>]              ...into a group chat with this id
       [--attachment <file.jpg>]   ...as an attachment (metadata only); text, if any, becomes an album caption
       [--react <emoji>]           ...as a reaction; the text is the message reacted to

Options (any command):
  --dry-run              Print the signed requests instead of sending
  --allow-real-numbers   Allow sender/line numbers outside +1555xxxxxxx
  -h, --help             Show this help

Env: GATEWAY_WEBHOOK_URL, PHOTON_WEBHOOK_SECRET, VICTIM_NUMBER (.env is loaded if present)`;

export interface CliDeps extends Omit<RunOptions, "dryRun" | "allowRealNumbers"> {
  config?: SimConfig;
  bankFiles?: string[];
}

function num(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got ${JSON.stringify(value)}`);
  return n;
}

/** Returns the process exit code: 0 if every send succeeded, 1 if any failed, 2 on usage errors. */
export async function main(argv: string[], deps: CliDeps = {}): Promise<number> {
  const log = deps.log ?? ((l: string) => console.log(l));
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        "dry-run": { type: "boolean", default: false },
        "allow-real-numbers": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        n: { type: "string" },
        "scam-ratio": { type: "string" },
        seed: { type: "string" },
        "interval-ms": { type: "string" },
        from: { type: "string" },
        group: { type: "string" },
        attachment: { type: "string" },
        react: { type: "string" },
      },
    });
  } catch (err) {
    log(`error: ${(err as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    log(USAGE);
    return values.help ? 0 : 2;
  }

  let config = deps.config;
  if (!config) {
    loadDotEnv();
    config = configFromEnv();
  }

  let steps: Step[];
  try {
    if (command === "scenario") {
      if (rest.length !== 1) throw new Error("scenario takes exactly one file");
      steps = loadScenario(rest[0]!);
    } else if (command === "random") {
      const seed = num(values.seed, "--seed", Math.floor(Math.random() * 2 ** 31));
      steps = randomSteps(loadBank(deps.bankFiles), {
        n: num(values.n, "--n", 20),
        scamRatio: num(values["scam-ratio"], "--scam-ratio", 0.6),
        seed,
        intervalMs: num(values["interval-ms"], "--interval-ms", 1500),
      });
      log(`random: seed=${seed}`);
    } else if (command === "send") {
      if (!values.from) throw new Error("send needs --from <number>");
      const text = rest.join(" ");
      if (values.attachment && values.react) throw new Error("send takes --attachment or --react, not both");
      let content: SimContent | undefined;
      if (values.react) {
        content = { type: "reaction", emoji: values.react, ...(text ? { targetPreview: text } : {}) };
      } else if (values.attachment) {
        const file: SimContent = { type: "attachment", name: values.attachment, mimeType: guessMimeType(values.attachment) };
        content = text ? { type: "group", items: [{ type: "text", text }, file] } : file;
      } else if (!text) {
        throw new Error('send needs the message text, e.g. send --from +15555550142 "hello"');
      }
      steps = [{ delayMs: 0, from: values.from, body: content ? "" : text, ...(content ? { content } : {}), ...(values.group ? { group: values.group } : {}) }];
    } else {
      throw new Error(`unknown command: ${command}`);
    }
  } catch (err) {
    log(`error: ${(err as Error).message}`);
    return 2;
  }

  let results: SendResult[];
  try {
    results = await runSteps(config, steps, {
      ...deps,
      dryRun: values["dry-run"],
      allowRealNumbers: values["allow-real-numbers"],
    });
  } catch (err) {
    log(`error: ${(err as Error).message}`);
    return 2;
  }
  return results.every((r) => r.ok) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
