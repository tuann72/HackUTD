// Copies the contract fixture into the web app. The web app never imports
// from outside apps/web (decoupling rule), so it keeps its own copy.
// Usage: npm run sync:contract        (copy)
//        npm run sync:contract -- --check   (exit 1 if the copy is stale)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("../../../contracts/fixtures/messages.v1.sample.json", import.meta.url));
const dest = fileURLToPath(new URL("../lib/messages/fixture.v1.json", import.meta.url));
const want = readFileSync(src, "utf8");
if (process.argv.includes("--check")) {
  const have = readFileSync(dest, "utf8");
  if (have !== want) {
    console.error("lib/messages/fixture.v1.json is out of date. Run: npm run sync:contract");
    process.exit(1);
  }
  console.log("fixture is in sync with contracts/");
} else {
  writeFileSync(dest, want);
  console.log("copied contracts/fixtures/messages.v1.sample.json -> lib/messages/fixture.v1.json");
}
