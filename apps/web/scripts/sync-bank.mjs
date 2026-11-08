// Copies the simulator's message bank and scenarios into the web app for the
// simulation panel. The web app never reads outside apps/web (Vercel builds only
// that folder), so it keeps its own copy, like sync-contract.mjs.
// Usage: npm run sync:bank           (copy)
//        npm run check:bank          (exit 1 if the copy is stale)
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../../../data/message_bank/", import.meta.url));
const dest = fileURLToPath(new URL("../lib/sim/bank.json", import.meta.url));

const jsonl = (path) =>
  readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

const rows = ["bank.jsonl", "generated.jsonl"].flatMap((f) =>
  jsonl(dir + f).map((r) => ({ id: r.id, text: r.text, label: r.expected_label, category: r.category })),
);
const scenarios = Object.fromEntries(
  readdirSync(dir + "scenarios")
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .map((f) => [f.replace(/\.jsonl$/, ""), jsonl(dir + "scenarios/" + f)]),
);
const want = JSON.stringify({ rows, scenarios }, null, 1) + "\n";

if (process.argv.includes("--check")) {
  let have = "";
  try {
    have = readFileSync(dest, "utf8");
  } catch {}
  if (have !== want) {
    console.error("lib/sim/bank.json is out of date. Run: npm run sync:bank");
    process.exit(1);
  }
  console.log("bank is in sync with data/message_bank/");
} else {
  writeFileSync(dest, want);
  console.log(`copied ${rows.length} bank rows and ${Object.keys(scenarios).length} scenarios -> lib/sim/bank.json`);
}
