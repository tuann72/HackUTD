# Feature: Sender blocklist and scam fingerprints (MongoDB Atlas)

- **Slug:** `sender-blocklist`
- **Phase:** MVP
- **Status:** **Parked, off by default** (Tuan, 2026-11-08). The module and wiring exist behind `SENDER_BLOCKLIST=on`. The default is `off`: each message is judged on its own.
- **Owner:** Timothy

## Goal

> **Parked (Tuan, 2026-11-08):** "we don't aim to block users, just block that instance of a message." This overrides the sender-level blocking below. The gateway blocks individual messages by the classifier's verdict. The blocklist code stays, behind `SENDER_BLOCKLIST` (default `off`: no blocklist calls, no Atlas connection). Everything below describes the `on` option.

Vultr is the judge: the classifier on Vultr scores every message, and above `BLOCK_THRESHOLD` the gateway blocks it, as today. This feature adds two things on top (Timothy, 2026-11-08; see `CHANGELOG.md`, "Sender blocklist and scam fingerprints in MongoDB Atlas"):

1. **Scam fingerprints:** every blocked message records a fingerprint of its sender and its text in **MongoDB Atlas**, so repeat senders and repeated scam texts can be recognized.
2. **Sender blocklist:** a sender that has proven itself a scammer is blocked straight away, without asking the model, for a limited time.

Not-scam messages go through to the victim's inbox as today.

```
Photon (iMessage) ──webhook──> gateway (Vultr VM)
                      │ 1. sender on the blocklist? ──yes──> blocked (reason: sender_blocked)
                      │ 2. no: POST /classify ──> classifier (Vultr)
                      │ 3. score ≥ BLOCK_THRESHOLD ──> blocked (model_verdict) + record fingerprint in Atlas
                      │                               (strikes / very high score put the sender on the blocklist)
                      └ 4. otherwise ──> delivered to the inbox
```

## Protecting innocent senders

The classifier is wrong on roughly 1–1.5% of legitimate messages, and scammers spoof real people's numbers. So one bad score must not silence a person:

- **Messages are judged one at a time by default.** A blocked message is held in the blocked log, never deleted, and can be reviewed.
- **A sender is blocklisted only on strong evidence:** `SENDER_BLOCK_STRIKES` scam messages (default 3) or one message scoring at least `SENDER_BLOCK_SCORE` (default 0.95). Defaults are TBD, tuned later.
- **Blocks expire** after `SENDER_BLOCK_TTL_DAYS` (default 7), so a spoofed number isn't banned for good.
- **A "Not a scam" override** removes the sender's block and allowlists it, so the model can't re-block it. See open questions for where that control lives.
- **Nothing reaches the sender.** The gateway never replies, and Atlas holds only keyed hashes.

## Privacy

Atlas is a third-party cloud database, so it never receives raw phone numbers or message text:

- **Sender fingerprint:** `HMAC-SHA256(FINGERPRINT_SECRET, normalized iMessage handle)`, hex. The handle is the E.164 number, or the Apple ID email lowercased (`src/handle.ts`). The secret lives only in the gateway's `.env`. Without it, a hash can't be reversed by trying every phone number.
- **Text fingerprint:** `HMAC-SHA256(FINGERPRINT_SECRET, normalized text)`, where normalized means lowercased, whitespace collapsed, and URLs and digit runs replaced by placeholders, so small variations of one scam match.
- **Stored with them:** score, category, model, strike count, first/last seen, `blockedUntil`, `allowlisted`. No message ids that link back to SQLite are needed; the gateway's SQLite keeps the masked display and the message as today.
- Vultr still receives only message text and an opaque id, as agreed.

## Out of scope

- Moving the inbox or blocked log to Atlas. **SQLite stays** the gateway's store (Tuan's decision); Atlas holds only fingerprints and the blocklist.
- Blocking at the carrier or in Twilio. "Blocked" means the gateway's virtual inbox, as today.
- Cross-user sharing of fingerprints (one victim number for now).
- Retraining from overrides (a later idea: each override is a real labeled example).

## Open questions

- **Override control (TBD, needs Tuan):** the decoupling rules say the web app never writes to the gateway. For the MVP the override is a gateway admin route behind a token (like `/debug/reset`) plus an `npm run` script. A button in the UI would change that rule.
- **Contract change:** a new `reason` value, `sender_blocked`, in `contracts/query-api.v1` (task 1.1). Additive, but the web app has to render it.
- **Defaults:** strikes, very-high score, TTL. Tune once the real model's score distribution on `val` is known.
- **Atlas outage:** proposed fail open, like the classifier. If Atlas can't be reached, skip the blocklist check and classify normally; log and drop the fingerprint write.
- **Atlas network access:** Atlas only accepts allowlisted IPs. Allow the Vultr VM's IP; for local dev, your own IP (avoid `0.0.0.0/0`).
- **Atlas tier and region:** proposed the free **M0** cluster, in a region near the Vultr VM.

## Tasks

Tasks are grouped into ordered stages. Tasks in the same stage can run **in parallel**. A stage starts only when the stages it depends on are done.

### Stage 1: foundations

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 1.1 | Contract: add reason `sender_blocked`; sync the web app's copy and render it | — | 1.2, 1.3, 1.4 | In review | `feat/sender-blocklist-gateway-flow` | Tuan + Claude Code | [#27](https://github.com/tuann72/HackUTD/pull/27) |
| 1.2 | Gateway: fingerprint + blocklist module (store interface, MongoDB implementation, in-memory fake, tests) | — | 1.1, 1.3, 1.4 | Done | `feat/sender-blocklist-module` | Timothy + Claude Code | [#23](https://github.com/tuann72/HackUTD/pull/23) |
| 1.3 | Atlas setup: M0 cluster, database user, IP allowlist, connection string in `.env` (person, not agent) | — | 1.1, 1.2, 1.4 | Parked (only needed with `SENDER_BLOCKLIST=on`) | | Timothy | |
| 1.4 | Vultr: train the model and deploy the classifier ([classifier plan](classifier-service.md), tasks 2.1 and 3.x) | — | 1.1, 1.2, 1.3 | Not started | | Tuan | |

### Stage 2: wire it in

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 2.1 | Gateway flow: blocklist check before classify, fingerprint after block, strikes/score/TTL rules | 1.1, 1.2 | 2.2 | In review | `feat/sender-blocklist-gateway-flow` | Tuan + Claude Code | [#27](https://github.com/tuann72/HackUTD/pull/27) |
| 2.2 | Override: `POST /admin/messages/restore` + `npm run message:restore`, which restores one message (allowlists the sender only when on) | 1.2 | 2.1 | In review | `feat/sender-blocklist-gateway-flow` | Tuan + Claude Code | [#27](https://github.com/tuann72/HackUTD/pull/27) |

### Stage 3: on Vultr, end to end

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 3.1 | Deploy the gateway on the Vultr VM ([runbook](../../services/gateway/DEPLOY.md), [Twilio MVP](twilio-mvp.md) task 3.1) with `CLASSIFIER_URL`, `MONGODB_URI`, `FINGERPRINT_SECRET`; add the VM's IP to Atlas | 1.3, 1.4, 2.1 | — | Parked (deploy itself is the Twilio-MVP/Photon task 3.1; Atlas only if on) | | | |
| 3.2 | End-to-end check: real classifier + Atlas + simulator and one real phone | 3.1 | — | Parked | | | |

## Task details

### 1.1 Contract: `sender_blocked`

- **What:** add `sender_blocked` to the `reason` enum in `contracts/query-api.v1.schema.json`, plus a fixture row. The verdict for such a message is `null` (the model wasn't asked). Run `npm run sync:contract` in `apps/web` and show it as "Blocked: known scam sender".
- **Files:** `contracts/`, `apps/web/` (contract copy, message row), `services/gateway/src/types.ts`.
- **Done when:** both packages' contract checks and tests pass.

### 1.2 Fingerprint + blocklist module

- **What:** `services/gateway/src/blocklist.ts`: `fingerprintSender(number)`, `fingerprintText(text)` (normalize, then HMAC), and a `Blocklist` interface (`isBlocked(senderFp)`, `recordScam({senderFp, textFp, score, category, model})` returning whether the sender is now blocked, `allow(senderFp)`). Two implementations: `MongoBlocklist` (official `mongodb` driver, collections `senders` and `scam_texts`, indexes on `_id`, TTL via `blockedUntil`) and `MemoryBlocklist` for tests and for running without Atlas. Env: `MONGODB_URI`, `MONGODB_DB` (default `tgate`), `FINGERPRINT_SECRET` (required when `MONGODB_URI` is set), `SENDER_BLOCK_STRIKES`, `SENDER_BLOCK_SCORE`, `SENDER_BLOCK_TTL_DAYS`. Strict timeouts, so Atlas can never hold up a decision for long.
- **Files:** `services/gateway/src/blocklist.ts`, `src/config.ts`, `.env.example`, `package.json`, `test/blocklist.test.ts`.
- **Done when:** unit tests cover hashing (same input → same hash, different secret → different hash, no raw number in any stored document), strikes, very high score, expiry and allowlist, against `MemoryBlocklist`; and one manual run against a real Atlas cluster.

### 1.3 Atlas setup

1. At cloud.mongodb.com create a project and a free **M0** cluster, in a region near the Vultr VM.
2. **Database Access:** a database user with read/write on database `tgate` only. Long random password.
3. **Network Access:** add your current IP for local dev, and the Vultr VM's IP once it exists (task 3.1).
4. **Connect → Drivers:** copy the `mongodb+srv://…` string into `services/gateway/.env` as `MONGODB_URI`. Never commit it or paste it in chat.
5. Make `FINGERPRINT_SECRET` with `openssl rand -hex 32` and put it in the same `.env`. Changing it later orphans every stored fingerprint.

### 2.1 Gateway flow

- **What:** in `classifyAndApply`: check `isBlocked` first, and if so block with `sender_blocked` without calling the classifier. Otherwise classify; on block, `recordScam`. Atlas errors are logged and ignored (fail open). An allowlisted sender is still classified (its messages can still be blocked one at a time) but never put back on the blocklist.
- **Files:** `services/gateway/src/app.ts`, `src/server.ts`, `src/db.ts` (reason enum), `test/gateway.test.ts`.
- **Done when:** gateway tests show 3 scam messages from one number → the 4th is `sender_blocked` without a classifier call; one ≥ 0.95 message blocklists at once; an expired block classifies again; Atlas down → messages are still classified and delivered.

### 2.2 Override

- **What (as built, after Tuan's 2026-11-08 decision):** `POST /admin/messages/restore` (behind `ADMIN_TOKEN`, off unless set) and `npm run message:restore -- <message id>`. It restores **only that message** to the inbox (reason `override`). With `SENDER_BLOCKLIST=on`, it also allowlists the sender's fingerprint. It takes a message id, so nobody has to type a phone number.
- **Done when:** a test restores a blocked message and the sender's next scam is judged by the model again, not by the blocklist.

## Progress notes
- **2026-11-08:** **Parked by Tuan:** block the message, not the sender. `SENDER_BLOCKLIST` added (default `off`). The override became `POST /admin/messages/restore` / `npm run message:restore` and restores only the named message. With `off`, no blocklist method is called (a spy test checks this) and a scam sender's next legit message is delivered. The `on` tests still pass.
- **2026-11-08:** Tasks 1.1, 2.1 and 2.2 built (`feat/sender-blocklist-gateway-flow`, [#27](https://github.com/tuann72/HackUTD/pull/27), stacked on the Photon PR #24). The blocklist check runs before the classifier, model blocks are fingerprinted, Atlas fails open, the contract has reasons `sender_blocked` and `override`, and the override is `POST /admin/senders/allow` (`ADMIN_TOKEN`) plus `npm run sender:allow`. Email handles are normalized. **Proposals for Tuan:** block a blocklisted sender's text-less content; override as an operator tool, not a web button; restore all of the sender's blocked messages. Not run against Atlas (task 1.3 needs a person).

- **2026-11-08:** Task 1.2 built: `services/gateway/src/blocklist.ts` (`MemoryBlocklist`, `MongoBlocklist`, keyed-hash fingerprints) and the `MONGODB_*`, `FINGERPRINT_SECRET`, `SENDER_BLOCK_*` settings. Not wired into the request flow yet (task 2.1). Tests: 54 pass; the 5 MongoDB tests also pass against a local `mongo:8` container (`MONGODB_TEST_URI`). Not yet run against Atlas (needs task 1.3).
- **2026-11-08:** Plan written (Timothy + Claude Code). Decisions: fingerprint = keyed hash of the number + keyed hash of the normalized text; blocklist on strikes or a very high score, with expiry and an override; SQLite stays, Atlas adds fingerprints only. Nothing is set up on Vultr or Atlas yet.
