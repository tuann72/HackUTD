# T-Guard Changelog

The team's decision log (newest first) and the detailed design spec behind it. Renamed from `DESIGN.md` on 2026-11-07.

The detailed, evolving design document. `AGENTS.md` holds the current summary; this file holds the reasoning. Mark anything undecided as **TBD**.

## Decision log

### 2026-11-08: Voice results page removed

Tuan asked to remove the Voice results page. Since #82 the voice worker sends each call's transcript to the VM gateway, so calls already show on `/messages`, and nothing fed `/voice` any more. Removed: the `/voice` page, `POST`/`GET /api/voice/calls`, the Atlas `voiceCallResults` store (`lib/server/voiceResults.ts`), `lib/voice`, the `voice-call-result.v1` and `voice-call-results.v1` contracts and fixture, the `VOICE_GUARD_RESULTS_*` env vars and the Voice results header tab. The LiveKit worker is unchanged. Existing `voiceCallResults` documents in Atlas, if any, are left in place (their TTL index expires them).

### 2026-11-08: /messages fills the screen, with a filterable message panel

Tuan asked to move the inbox and blocked lists into a left panel with filters, make the page fit the screen, and use Motion (motion.dev) for UI animation (#88).

- **/messages layout:** on wide screens (`lg`, 1024 px and up) the page is exactly one window tall, with no page scroll. Three columns each scroll on their own: the message panel on the left, the 3D scene in the middle (the Shield | Hand switch and the Threats blocked and Delivered counters sit on top of it), and Simulate on the right, which now collapses to a thin strip. On phones they stack: scene, messages, Simulate.
- **Message panel:** All, Inbox and Blocked tabs with counts, a search box (sender, text or category; every word must match), and a Filters drawer with a scam-category menu (only the categories present, plus "Known scam sender"), a sort (newest, oldest, highest scam score) and chips (Not checked, Money request, Restored, Group chat). Pending messages always stay on top. Clear chats and Clear blocks moved to the panel's footer. The filters are display only (`components/messages/filter.ts`, tested); they never change a verdict.
- **Header:** `/messages` and `/dashboard` share one header (`components/brand/AppHeader.tsx`) with Messages, Dashboard and Voice results tabs instead of separate buttons. Notices (after Unblock or Clear blocks) are a toast at the bottom.
- **Dashboard:** the totals sit beside the title, the six panels are in three columns on wide screens, and the bars and score columns grow to their new values with Motion springs.
- **Motion:** used only where something answers a person's action or new data arrives (tab indicator, filter drawer, cards entering or leaving the list, counters ticking, bars growing). `MotionConfig reducedMotion="user"` turns it off for people who ask for reduced motion.

### 2026-11-08: Sender blocklist on, with Unblock and Clear blocks buttons

Tuan reversed the morning's parking decision: the gateway now blocks repeat scam senders by default (`SENDER_BLOCKLIST` defaults to `on`; Atlas when `MONGODB_URI` is set, else in memory). To keep a person in control, the web UI gets two buttons, both behind a password the user types (`4321`, set by `UI_ACTION_PASSWORD`): **Unblock** on a blocked message restores it and allowlists the sender, and **Clear blocks** deletes every sender record so everyone blocked is unblocked. The password is checked on the gateway (and on the Vercel backup), never in browser code. These are the third kind of write the web app makes, after Clear chats and Simulate. Blocked messages stay in the log after Clear blocks, and text fingerprints are kept. Open: the strike/score/TTL defaults, and the 4-digit password is only a demo guard. See `contracts/README.md`, "Unblock and Clear blocks".

### 2026-11-08: Voice transcripts go to the VM gateway like simulated messages

- **Decision (LacsJP27):** the voice-guard worker sends each finished call's transcript to the gateway on the VM as a signed Photon (Spectrum) inbound-iMessage webhook on `/webhooks/photon`, the same path the perpetrator simulator and the Simulate panel use. The gateway classifies it, applies its block/deliver policy (threshold, review band, money rule) and stores it, and `/messages` shows it through `GET /api/messages`.
- **Replaces** the worker's direct `POST /classify` call and its upload to the Vercel `/api/voice/calls` endpoint. The worker no longer reads `CLASSIFIER_*` or `VOICE_GUARD_RESULTS_*`; it reads `GATEWAY_WEBHOOK_URL`, `GATEWAY_WEBHOOK_SECRET` (the gateway's `PHOTON_WEBHOOK_SECRET`), `GATEWAY_TIMEOUT_MS` and `VOICE_GUARD_VICTIM_LINE`.
- **Why:** one decision path for messages and calls, with no gateway change and no classifier exposed to LiveKit Cloud (the Caddy classifier proxy in #78 is no longer needed for voice).
- **Payload:** `message.id` `voice-<uuid>`, sender = the SIP caller number (`sip.phoneNumber`, or `+10000000000` if missing), `space.id` `voice;-;<caller>`, text content = the transcript.
- **Limits / follow-ups:** a call appears in the UI as a text message (no call badge or message kind); one send with no retry; the Vercel `/voice` page and `/api/voice/calls` route stay in the web app but the worker no longer feeds them (remove or keep is TBD).

### 2026-11-08: End-to-end result and a model comparison on the message cards

- **End to end, v0.5 plus Nemotron with Nessie, 606 real test texts (156 scams), cutoff 0.70:** accuracy 98.5%, F1 97.1%, 5 scams missed, 4 false blocks. Nemotron reviewed 18 of the 606, caught 3 more scams and added no false blocks. No text reached it through the money rule alone, so this doesn't measure that rule. Roughly, the true catch rate is 93-99% and the false-block rate 0.3-2.3%.
- **Each model alone on the same 606 texts (missed / false blocks):** stacked LR 8 / 4, TF-IDF + SGD 11 / 2, TF-IDF + LR 10 / 7, MiniLM + LR 9 / 29. TF-IDF and MiniLM are the two halves of v0.5. SGD was trained on the same rows, with alpha picked on val, and isn't deployed.
- **Web:** the model name on a card opens these figures as a fixed table labeled "Model comparison". It doesn't switch models.

### 2026-11-08: Two more captions removed

- **Decision (Tuan):** remove the Simulate sidebar's line "Sends signed, simulated iMessages from fictional numbers to <gateway host>." and the "Masked by the gateway" note on the dashboard's Most active numbers panel. Nothing else changes: simulated senders are still fictional `+1555` numbers and the numbers shown are still masked by the gateway.

### 2026-11-08: Rapid fire uses its own 200-sentence dataset

- **Decision (Tuan):** a Rapid fire dataset of 200 complete sentences, 40% scam and 60% legitimate, and Rapid fire draws from it. No note about it in the UI.
- **Data:** `data/message_bank/rapid.jsonl`, written by `build_rapid.py` (hand-written messages, fictional links and names). 80 scams: Imposter & Phishing 22, Prizes 12, Jobs & Investment 12, Loans 10, Health 8, Shopping 8, Internet & Telecom 5, Threats & Extortion 3. 120 everyday texts. No grandparent-style scams. Demo input, not training data.
- **Wiring:** `npm run sync:bank` copies it into `apps/web/lib/sim/bank.json` as `rapid`. The Rapid fire preset has `dataset: "rapid"` and a scam ratio of 0.4 (was 0.6), so each run sends 20 scams and 30 legit texts with no repeats. Send a scam, Send a legit text, Random burst and the CLI simulator keep the main bank.

### 2026-11-08: Less small text on /messages, bigger totals labels

- **Decision (Tuan):** remove the small captions on `/messages`: "01 / The protector" and "Fictional senders. Real classifier." under the scene, "You're in good hands." and "Let through, untouched." under the totals, and the footer note "“Potential scam” is the classifier's verdict and can be wrong. Links and phone numbers in blocked messages are disabled." The "Threats blocked" and "Delivered" labels go from 10px to 20px (`text-xl`). Links and numbers in blocked messages are still disabled; only the note saying so is gone.

### 2026-11-08: Grandparent scam button removed from Simulate

- **Decision (Tuan):** remove the grandparent scam story from the Simulate sidebar. Its preset is gone from `apps/web/lib/sim/presets.ts`, so the sidebar now has Send a scam, Send a legit text, Random burst and Rapid fire. The scenario file `data/message_bank/scenarios/grandparent.jsonl` stays, like the removed iMessage demo and Smoke test presets, because the CLI simulator (`npm run sim -- scenario grandparent`) can still run it. The demo walkthrough in `docs/DEMO.md` runs `imessage-demo` from the CLI and is unchanged.

### 2026-11-08: Landing T without the black slab, with two small squares

- **Decision (Tuan):** in the landing page's block "T" (`components/landing/Blocks.tsx`), remove the black slab, add the missing serif under the right end of the crossbar (it mirrors the left one), and add two small squares beside the stem with a small gap (3% of the panel) on each side. Each square is its own shade of pink: paler `#f483b0` on the left, darker `#d81b6a` on the right. The squares keep a 1:1 aspect ratio, so they stay square whatever the panel's shape.

### 2026-11-08: The shield's T uses a font close to T-Mobile's

- **Decision (Tuan):** make the T on the 3D shield closer to T-Mobile's font. T-Mobile's typeface, TeleNeo, belongs to Deutsche Telekom and isn't free to use, so the T is the "T" outline of **Manrope ExtraBold** (weight 800, SIL Open Font License), a free geometric sans with similar flat-ended, even strokes. It replaces the hand-drawn block T in `components/scene/Shield.tsx`, at the same top and bottom (11.1 icon units tall). It is narrower and slimmer: stem 2.1 and crossbar 2.0 units, where the block T's were 3.1. The outline is stored as eight points, so no font file is loaded at runtime. It is a letter in a font, not T-Mobile's logo.

### 2026-11-08: Add the after-call classifier result path and Vercel display

- **User request:** pass the caller transcript to the existing classifier and render the result in the Vercel app.
- **Worker flow:** after STT finalizes on hangup, the worker sends the finalized caller transcript unchanged as `text` in `{ messageId, text }` to `POST /classify`. The ID is an opaque UUID and the worker verifies that the response echoes it. On success, it posts the transcript and verdict fields to `VOICE_GUARD_RESULTS_URL` with `VOICE_GUARD_RESULTS_INGEST_TOKEN`. Neither transcript nor credentials are logged, and an upload failure does not affect call completion.
- **Contract and app:** added v1 submission and query schemas, a synthetic fixture, `POST /api/voice/calls`, and a read-only `GET /api/voice/calls`. The `/voice` page requires an operator-entered view token, keeps it only in React memory, refreshes every five seconds, and renders transcript, verdict, score, category, model, and completion time. The worker and web app exchange only the versioned contract, not code.
- **Persistence gate:** Vercel refuses result writes unless Atlas, separate ingest and view tokens, and a positive `VOICE_GUARD_RESULTS_TTL_SECONDS` are configured. Records go to a separate Atlas collection with `expiresAt` anchored to call completion, a Mongo TTL index, and an expiry filter on reads. Local development may use process memory. No default TTL is selected; the duration and intended viewer list remain TBD. The view token is a protective shared-secret mechanism, not a settled identity policy.
- **Limit:** the classifier is SMS-trained, so the call verdict is an experimental plumbing result, not validated call-level accuracy. No live call, classifier evaluation, or paid usage test was run in this task.
- **Status:** task 1.3 call-script evaluation remains in progress; task 1.4 is under review in the consolidated `feat/voice-guard-call-results` PR #63. The worker and result API are included together; the production Cloud worker still needs classifier/result configuration.

### 2026-11-08: Deploy the caller-only worker to LiveKit Cloud

- **Deployment:** the production `voice-guard` agent was deployed in `us-east` on the existing LiveKit Cloud Build project and registered under the expected agent name.
- **Configuration:** `VOICE_GUARD_CAPTURE_ENABLED=true`; LiveKit injects its project credentials. The local `.env` was excluded from the deployment. `CLASSIFIER_URL`/`CLASSIFIER_TOKEN` and result publishing are not configured in Cloud.
- **Limit:** the deployment answers/transcribes only until classifier and Vercel result settings are configured. No post-deployment call was placed.

### 2026-11-08: Verify local voice answer and transcription; select LiveKit Cloud deployment

- **Verification:** the user placed a consented call after the `T-Gate Voice` SIP dispatch rule was assigned to `voice-guard`. The worker published a zero-amplitude audio track, LiveKit SIP status changed `ringing` → `active` → `hangup`, and AssemblyAI Universal-Streaming produced non-empty speech text. A one-call local log displayed the transcript at the user's request, then the logging change was removed; no transcript was persisted.
- **Answer media:** the worker publishes a zero-amplitude audio track so the caller is answered without a spoken response. Caller audio remains the only audio sent to STT.
- **Limit:** `CLASSIFIER_URL` and `CLASSIFIER_TOKEN` were unset, so no verdict was produced. At that point no call-result store or Vercel display existed yet.
- **Deployment decision (user):** deploy the worker to LiveKit Cloud on the existing Build plan. The service has a multi-stage Dockerfile, production build config, and `.dockerignore`. `npm run build` and `npm run typecheck` passed; the Cloud deployment itself was not yet complete.
- **Plan:** [`docs/features/voice-scam-guard.md`](docs/features/voice-scam-guard.md), tasks 1.1, 1.2, and 1.6.

### 2026-11-08: Add the caller-only LiveKit STT worker

- **What:** add `services/voice-guard/`, a TypeScript LiveKit Agents worker that subscribes only to SIP participant audio, streams to AssemblyAI Universal-Streaming through LiveKit Inference, buffers final transcript text in memory, and calls the existing classifier after the audio track ends using a random UUID as `messageId`.
- **Privacy and failure behavior:** capture is disabled unless `VOICE_GUARD_CAPTURE_ENABLED=true`; audio and transcripts are not persisted, and transcript text is not logged. STT/classifier errors are caught so the worker does not explicitly terminate the call. No call-result store or Vercel display is added at this point in the history.
- **Initial status:** `npm run typecheck` passed. The worker had not yet been deployed or attached to the SIP dispatch rule; Stage 1.1 audio verification and Stage 1.2 live transcription remained in progress. No test call or inference usage test was run at that stage.
- **Reference:** [LiveKit job lifecycle and raw audio track processing](https://docs.livekit.io/agents/server/job/).

### 2026-11-08: Select STT for the voice scam guard

- **Decision (user):** use AssemblyAI Universal-Streaming through LiveKit Inference for the caller-only voice prototype. The model ID is `assemblyai/universal-streaming`; English is sufficient for the planned scripted proof.
- **Why:** it integrates through the existing LiveKit room, needs no separate AssemblyAI API key, and the current LiveKit Build/Ship rate is `$0.0025/min`. LiveKit documents that Inference is zero-data-retention by default, including model audio and output; this does not define how T-Gate retains the final transcript.
- **Implementation:** use a Node.js/TypeScript LiveKit agent worker, consistent with the repository service stack. Subscribe only to the SIP caller track, buffer final transcript text in memory, and call the text classifier after hangup. Do not write audio to persistent storage or print transcript text in logs.
- **Still TBD:** deployment target, consent/disclosure process, transcript retention duration, result storage/API, and call-level classifier evaluation. No test call or paid usage test was part of the original decision.
- **References:** [LiveKit STT models](https://docs.livekit.io/agents/models/stt/), [LiveKit Inference privacy and authentication](https://docs.livekit.io/agents/models/inference/), and [LiveKit Inference pricing](https://livekit.com/pricing/inference).

### 2026-11-08: Wordmark shield as tall as the letters

- **Decision (Tuan):** the shield that stands for the U in T-GUARD is as tall as the capitals around it, on the landing page and wherever the wordmark appears (`/messages` and `/dashboard` headers). `ShieldLetter` sets its height to `1cap` (the font's cap height), so it matches Anton (0.86em) on the landing page and Inter (about 0.73em) in the headers. It was 0.74em, short of Anton's capitals. Browsers without the `cap` unit fall back to 0.8em.

### 2026-11-08: Shield or hand switch; Rapid fire button; two presets removed

- **Decision (Tuan):** bring the hand back as an option. A **Shield | Hand** switch replaces the "On guard" status above the scene (shield is the default, not remembered across visits). Shield mode works as before; hand mode is the earlier slapping hand in its "T-GUARD" box: shots fly at the hand, delivered ones land in it, blocked ones stop short and get slapped. A shot keeps the guard it was fired with, so switching mid-flight is safe. `Hand.tsx`, `slap.ts`, its tests and the hand images are restored.
- **Simulate:** the iMessage demo and Smoke test buttons are removed (their scenario files stay in the bank). A new **Rapid fire** button sends 50 mixed messages (60% scams) 100 ms apart; the interval floor (`LIMITS.minIntervalMs`) drops from 250 to 100 ms. Random presets now always use their own count, ratio and interval.
- **Limit to know:** `/api/simulate` allows 60 simulated messages per minute, so one Rapid fire fits; a second one within the same minute stops partway with "Too many simulated messages; wait a minute." The scene animates at most one shot every 600 ms and drops older queued ones, so a burst shows only some of the 50; the lists show them all.

### 2026-11-08: Message text size follows its length

- **Decision (Tuan):** larger text for short messages, smaller for long ones. `bodySizeClass` in `components/messages/MessageBody.tsx` steps by trimmed character count: up to 30 characters 24px, up to 80 20px, up to 160 17px, up to 320 15px (the old size), longer 13px. It applies to every message body in the Inbox and Blocked cards.

### 2026-11-08: Nemotron always reviews large money asks, new decision prompt

- **Rule:** a message asking for at least `MONEY_WARN_AMOUNT` now goes to Nemotron even when its score is below `REVIEW_BAND_LOW`, because the classifier can't weigh amounts. Scores at or above `REVIEW_BAND_HIGH` stay blocked without review.
- **Why the prompt changed first:** run on the live model, the old prompt blocked every money ask it reviewed, including "Can you venmo me $600 for your half of the flights", and blocked "free cinnamon rolls!". Its reasons were often just "no bank data". The new `DECIDE_PROMPT` says a request for money alone is not a scam sign, lists the warning signs (rushed, secret, new number, emergency, an amount that doesn't fit the reason) and says missing bank data means nothing for a personal message.
- **Checks (hand-written, small, real Nemotron, mock bank):** in the texts the prompt was tuned on, "Free at last! No more school!", the $600 flights text and "free cinnamon rolls!" reach the inbox, and the $6000 bus fare is blocked. In a batch of 24 written before the final prompt (one wording tweak followed its first run): every harmless text that was reviewed was delivered (6 of 6), and 2 of 3 reviewed scams were blocked.
- **Known limits:** "can you please help me with $1800, i got stranded and nobody else can help" is delivered with the money warning. Some harmless money asks score at or above 0.77 and are blocked without review ("can you transfer $900 for your share of rent", 88%). "the $800 for the security deposit like we talked about" is still blocked, with an inaccurate reason ("Urgent request for a large sum"). Nemotron has a rate limit; a 429 keeps the model's decision.

### 2026-11-08: A "T" on the shield instead of the check mark; shield moved left

- **Decision (Tuan):** put a "T" on the shield instead of the check mark, and move the shield a few pixels left. The T is a raised white block letter (crossbar over a stem) extruded on the shield's face. It is an original letterform, not T-Mobile's logo (the T with small squares beside it), which is their trademark; the magenta shield keeps the T-Mobile feel. The shield moved from x 2.2 to 1.9 world units (about 25 to 35 px).
- **Wordmark (Tuan):** the "U" in "GUARD" is the magenta shield (`components/brand/ShieldLetter.tsx`, Lucide `shield` outline, filled `#e20074`) in the landing title and the `/messages` and `/dashboard` headers. Screen readers still read "U".

### 2026-11-08: A pink shield replaces T-Guard's hand and box

- **Decision (Tuan):** replace the hand and box with a shield icon, "pink like T-Mobile", in the same position. The shield is Lucide's `shield-check` (lucide.dev, ISC license): the outline is filled and extruded into a 3D badge in T-Mobile magenta `#e20074`, with the check mark in white on its face (`apps/web/components/scene/Shield.tsx`, built with three.js `SVGLoader`). It floats and sways and keeps the "T-Guard" label underneath.
- **Behavior:** a blocked message flies to the shield's face, gets the "Potential scam · Blocked" stamp, and bounces back toward the sender while the shield punches, rocks back, glows and throws a pink ring. A delivered message arcs over the shield and lands on the Receiver bean, which bounces.
- **Removed:** `Hand.tsx`, `slap.ts` and its tests, and `public/scene/hand/*.webp`. They came from the T-GUARD offline prototype and nothing else used them.

### 2026-11-08: No em dashes, sortable senders, a "T" on the landing page

- **Decision (Tuan):** no em dashes in the UI. The wordmark and box text read "T-GUARD", missing values show "N/A", and ranges use "to" (score buckets, the dashboard's time span, simulate error messages). Code comments and message-bank sample texts are not UI and were left alone.
- **Dashboard:** the most-active-numbers table sorts by Messages, Blocked or Share (click a header; click again to flip). Share orders like Messages, since it is each sender's part of all messages. Sorting is `sortSenders` in `lib/messages/stats.ts`, tested.
- **Landing:** the pink blocks now form a **T** in the same flat-block style: a crossbar (hot pink, light pink, deep-pink end cap), a light-pink serif under its left end, a stem with a deep-pink foot, the black slab beside the stem, and the thin rules.

### 2026-11-08: Harmless official-sounding texts, model v0.5

- **Problem (Timothy):** the 600 government, IRS, ID and health scam rows had no harmless counterparts, so words like "IRS", "Medicare" or "prescription" could become scam cues by themselves, the way "free" did. "Your order is ready for pickup at the pharmacy" scored 72%.
- **Data:** `data/official_ham_synthetic.csv`, 700 label-0 template rows from `data/build_official_ham_synthetic.py`: taxes, government offices, IDs, doctors, pharmacy and appointment notices, with no threat, payment demand, link or request for ID numbers. 687 survive `build_splits.py`.
- **Model `stacked-lr-category@0.5`, same cleaned test of 3,068 real messages, v0.4 → v0.5:** at the live cutoff 0.70, false blocks 17 → 17 and missed scams 45 → 43. At 0.5, false blocks 24 → 25, missed scams 29 → 31, SMS F1 0.959 → 0.955, ECE 0.008 → 0.007. These differences are within a few messages, so treat the two as tied on real text. Threat check file, blocked: 96.6% → 98.3%; hard negatives blocked 0% on both.
- **Hand-written check, none in training, small and agent-written:** official-sounding harmless texts at or over 0.5: 1 of 12 → 0 of 12 (the pharmacy text dropped from 72% to 3%). Matching scams caught at 0.70: 7 of 8 → 8 of 8. Ordinary "free" texts over 0.5: 2 of 18 → 3 of 18, none over 0.77.
- **Known limits:** "Can you lend me $6000 for the bus fare?" scores 24% and "my car broke down, can you zelle me $2500 asap" 32%, so both are delivered with the money warning. "Your health plan is cancelled..." is blocked at 72%, just over the threshold, and is named Health & Pharmacy.

### 2026-11-08: Calm money requests: more data, a warning rule, block threshold 0.70

- **Problem (Timothy):** "Can you lend me $6000 for the bus fare?" scored 0%. "lend me" appeared in no training row, and the model can't weigh amounts. Separately, ordinary texts like "Free at last!" were blocked because "free" alone read as a scam cue.
- **Models:** `stacked-lr-category@0.3` added Tuan's 300 harmless "free" texts. `@0.4` adds `data/money_request_synthetic.csv`: polite large asks, the "new number" scam, strangers asking for money and government threats as label 1, small everyday asks and talk about large amounts as ham. "Bus fare" is deliberately absent from the templates. 843 of its 1,302 rows survive `build_splits.py`, because amounts normalize to the same text.
- **Same cleaned test, 3,068 real messages, cutoff 0.5, v0.2 → v0.3 → v0.4:** false blocks 27 → 27 → 24, missed scams 33 → 32 → 29, SMS F1 0.952 → 0.955 → 0.959, ECE 0.007 → 0.006 → 0.008. Threat check file, blocked: 95% → 97% → 97%; hard negatives blocked 0% throughout.
- **Hand-written check, none in training, small and agent-written (v0.4):** 12 of 12 scams caught, including the IRS warrant text the earlier models missed. Of 18 ordinary "free" texts, 2 are over 0.5 and none over 0.77.
- **Warning rule (`services/gateway/src/money-rule.ts`, `MONEY_WARN_AMOUNT`, default $500):** a delivered message that asks the reader for at least that amount gets `verdict.warning: "large_money_request"`, and the web card shows a note. It never blocks, since real family ask for money too. Additive to query API v1.
- **Threshold (Timothy):** the VM's `BLOCK_THRESHOLD` is **0.70**, a stopgap for false blocks that lowering would bring back. The repo default stays 0.5.
- **Known limits:** "Can you lend me $6000 for the bus fare?" still scores 19% and is delivered with the warning. "my car broke down, can you zelle me $2500 asap" dropped from 76% to 37%, also delivered with the warning. "Your order is ready for pickup at the pharmacy" scores 72%, so it's a false block at 0.70.

### 2026-11-08: Dashboard page; T-Guard moved left of the Receiver

- **Decision (Tuan):** a **Dashboard** button left of Clear chats opens `/dashboard`, "overall analytics based on the messages sent and what they are composed of", noting the most prevalent values. It counts the gateway's decisions in the polled data (the latest 100 messages): totals, block rate, average scam score, the most active senders (masked numbers, with blocked counts), scam categories of blocked messages, message types, a score histogram, outcomes and reasons. The top row of each breakdown is tagged "Most common". Aggregation is a pure function (`lib/messages/stats.ts`, tested).
- **Scene:** T-Guard's box and hand moved 0.8 units left so they no longer hide the Receiver bean; the bean moved a little forward and its label is under its feet like the Sender's. The "T—GUARD / Active defense system" text is back on the box, which is still labeled "T-Guard" underneath.

### 2026-11-08: Thicker fonts, bean characters, T-Guard box label

- **Decision (Tuan):** fonts were too thin. Body text and `font-label` are **Inter** (body weight 500, labels bold), replacing Arial and Courier New. Archivo was tried first and was hard to read. Anton stays for the big counter numbers.
- **Buttons:** every enabled button shows a pointer cursor (Tailwind 4 defaults buttons to the arrow) and a visible hover. The Simulate buttons lost their ↗ arrows.
- **Scene:** the sender sphere is now a jellybean character (capsule body, face patch with big eyes, stubby arms and feet; an original bean in a party-game style, not any game's art). A pink Receiver bean stands behind the hand, labeled above its head, and bounces when a message is delivered. The "T—GUARD / Active defense system" text is gone from the pink box; the label under the box says "T-Guard".

### 2026-11-08: `/messages` restyled to match the T-GUARD prototype

- **Decision (Tuan):** make `/messages` match the T-GUARD offline prototype (the source of the scene's hand) and the landing page. Palette from the prototype's `demo/style.css`: paper `#f2f0e9`, ink `#211e20`, hot pink `#ef167d`, rules `#c9c6c0`, cards `#fffdf9`. Anton for big numbers, Courier New for small uppercase labels. These are Tailwind theme tokens in `app/globals.css` (`bg-paper`, `text-ink`, `text-hot`, `border-rule`, `bg-card`, `text-muted`, `font-display`, `font-label`).
- **Page:** `T—GUARD®` wordmark header linking to `/`, the scene on paper (was navy) with prototype-style captions, a "000 Threats blocked" / "Delivered" counter row, square cards (blocked ones with a pink edge), pink "Potential scam" stamps, pink keyword highlights, and the Simulate sidebar as outlined label buttons.
- **Light only:** the prototype has no dark mode, so `dark:` utilities now apply only under a `.dark` class (nothing sets it). The OS dark setting no longer changes the site.

### 2026-11-08: Government-threat, IRS, ID-request and health scam training texts

Tuan asked for more synthetic scam data covering government threat scams, health scams, anything asking for ID, and IRS scams, 150 rows each, all scams. `data/build_gov_health_id_scam_synthetic.py` writes `data/gov_health_id_scam_synthetic.csv` (600 template rows). Labels follow `scam_categories.csv`: government threats, IRS and ID requests are impersonation or phishing, so label 1 (Imposter & Phishing); health scams are label 5 (Health & Pharmacy). They're not label 8 (Threats & Extortion), which covers personal threats and fake emergencies, not an agency threatening arrest. `classifier/build_splits.py` reads the file with the threat templates, so 15% of each scenario goes to val; its manifest key `val_threat_templates` is now `val_templates`. No hard negatives were added (real IRS or pharmacy texts), and the model was not retrained. See `data/README.md`, section 6.

### 2026-11-08: Nemotron second-opinion review (proposal, off by default)

- **What (Timothy + Claude Code):** when the stacked model's score is in the review band (default 0.22 to 0.77), NVIDIA Nemotron picks read-only checks from a fixed list, the gateway runs them against Nessie (Capital One's mock bank) or local mock data, and Nemotron returns block or deliver with a short reason. See `docs/features/nemotron-review.md`.
- **Safety:** `REVIEWER=off` by default. Any failure or timeout keeps the model's decision. Nemotron gets no tools or URLs, only found flags, counts and short labels. VM gateway only; no database migration.
- **Still TBD:** team agreement, the NVIDIA track, and whether bank results may go to NVIDIA beyond mock data.

### 2026-11-08: A slapping hand replaces the Receiver blob

Tuan: replace the right blob in the scene with a hand that slaps, after the T-GUARD offline prototype. The Receiver is now the prototype's pink box with its photographic hand (the two WebP images, about 340 KB) standing in it, cut off at the box top by a clipping plane. A blocked potential scam stops within reach; during the hand's wind-up it drifts to where the palm will be at contact, then it is knocked back toward the sender, spinning and fading. The strikes reuse the prototype's slap-left, backhand and delayed timings (`components/scene/slap.ts`, unit-tested). This replaces the shield flash and the bubble pop; the "Potential scam · Blocked" stamp stays. Not ported: the box lid animation, the notification cards and the synthesized sound. The scene still only animates the gateway's decision.

### 2026-11-08: Free-ham rows merged into the 100k files

Tuan: merge the 300 harmless "free" texts into the main dataset. They are appended to `scam_categories_100k_full.csv` and `scam_categories_100k.csv` (100,000 → 100,300 rows, `split = train`, `source = synthetic_free_ham`). `build_splits.py` no longer reads `free_ham_synthetic.csv` separately, which would duplicate them, so all 300 now train (none go to val). The threat files and `spam_ham_100k*` are unchanged.

### 2026-11-08: Harmless "free" training texts

Tuan: the classifier overfit on "free" and flagged texts like "Feel free to do this" or "Free pizza". Added `data/free_ham_synthetic.csv` (300 ham rows using "free" harmlessly: "feel free", "are you free", free food at events, "parking is free", idioms), built by `data/build_free_ham_synthetic.py`. `classifier/build_splits.py` merges it with the threat rows (255 train, 45 val). It only takes effect after a retrain, which hasn't been run. There's no held-out "free" ham eval yet. See `data/README.md`, section 5.

### 2026-11-08: Landing page at `/`, app moves to `/messages`

- **Decision (Tuan):** `/` is a landing page from Tuan's mock: "T-GUARD" in a heavy condensed face (Anton), the tagline "Security that moves with you." (Archivo), and a pink/black color-block composition on the right, plus a **Start** button.
- **Start** opens the scene and inbox/blocked lists, which moved from `/` to `/messages` (the route the MVP plan first used). `/scene` now redirects to `/messages`; the old `/messages` → `/` redirect is gone.

### 2026-11-08: Simulate sidebar on the home page

- **Decision (Tuan):** run perpetrator simulations from buttons on `/`, configurable, instead of only from the CLI.
- **How:** a sidebar (`components/sim/SimPanel.tsx`) with preset buttons from `apps/web/lib/sim/presets.ts` (one scam, one legit text, random burst, and the bank's scenarios), burst settings (count, scam share, interval, sender, seed), a custom message box, Stop, and a log of what was sent. The browser paces the run and posts one step at a time to `POST /api/simulate`, which signs a Photon `messages` webhook (`X-Spectrum-Signature`) and sends it to the gateway. Pacing in the browser keeps each request short (Vercel time limits) and makes Stop immediate.
- **Why server-side signing:** the webhook secret must never reach the browser. The legacy `v0` signature uses the secret string as-is, so it works against the VM gateway and the Vercel backup even when their secret is a Beta `whsec_` value.
- **Decoupling:** a second exception to "the web app never writes to the gateway", after Clear chats. Unauthenticated by choice; rails: fictional `+1555` numbers only, no `photon.codes` target, 1,000-character text, 60 sends a minute per server instance (best effort). Off (panel says why) when no target or secret is configured, which includes replay mode.
- **Bank copy:** `npm run sync:bank` copies `data/message_bank/` into `apps/web/lib/sim/bank.json`, because Vercel builds only `apps/web`. `npm run check:bank` fails when it's stale.
- **TBD:** authentication for `/api/simulate` before a public demo.

### 2026-11-08: Project renamed to T-Guard

- **Decision (Tuan):** the project is called **T-Guard**, not T-Gate. Every user-facing and written mention (web page title and header, UI strings, docs, comments, service descriptions, the Photon webhook destination name) now says T-Guard.
- **Kept on purpose:** technical identifiers that the running deploy and stored data depend on still say `t-gate`/`tgate`: the query-API contract value `t-gate.query-api` (gateway and web must change together), npm package names, the VM's `/opt/t-gate` path, `tgate` system user and `t-gate-gateway` systemd unit, the `tgate` MongoDB database, the `TGATE_DOMAIN` variable, and the Vultr instance and SSH-key names. Renaming them needs a coordinated redeploy and data migration; whether to do it is TBD.

### 2026-11-08: Retrained with a 9th category, Threats & Extortion, on leak-free splits

- **Decision (Timothy):** add label 8 as a real category, shown as **"Threats & Extortion"** rather than "Potential Threat", which read as vague for a scam type. Rows in `potential_threat_*.csv` keep the old `category_name`; only the numeric label is used. Settles "binary vs. 8-class vs. 9-class" for the served model.
- **Leak-free data (`classifier/build_splits.py`):** the real test split stays the anchor. Text matching a held-out message (after normalizing case, punctuation and digits, or the same word set reordered) is removed from train and val, along with synthetic children of held-out rows. That removed 2,674 leaking train rows and 96 val rows, plus 10,456 duplicates inside train and 87 inside test.
- **Separate runs:** `train.py` reads `train_val.csv` and never loads the test file. `classifier/evaluate.py` scores the finished model on `test.csv` and `threat_eval.csv` through the service's own code.
- **Val includes threat templates:** real val has no threats and the stacker is fit on val, so 15% of each threat scenario (592 rows) goes to val. Metrics and thresholds use real val rows only. Test stays 100% real.
- **Results, same cleaned test (3,068 real messages, cutoff 0.5), old → new:** false blocks 26 → 27, missed scams 33 → 33, SMS F1 0.952 → 0.952, F1 0.981 → 0.980, category accuracy 0.944 → 0.943, ECE 0.008 → 0.007. Threat check file (58 threats, 42 hard negatives): threats blocked 22% → 95%, named correctly 0% → 93%, hard negatives blocked 5% → 0%. That file shares an author with the templates, so these numbers are optimistic.
- **Also compared:** TF-IDF + SGD (log loss) against TF-IDF + LR on half of val: same F1 (0.982), 5 s against about 221 s to fit, slightly lower category accuracy. Not adopted: training time isn't a constraint.
- **Real-world threat data:** public sets are scarce, and TExtPhish and ThreatCore are CC BY-NC-ND. The plan is TExtPhish as an external test only, never trained on and never committed (`evaluate.py --external`). Download is still blocked by a 403 on the gated files, so this test has not run.
- **Still TBD:** the block threshold (suggested: 0.22 for 97% precision, 0.77 for 99%, picked on val), and whether self-harm-style messages should warn instead of block.

### 2026-11-08: "Clear chats" deletes messages instead of hiding them

- **What (Tuan + Claude Code):** the web UI's "Clear chats" button now deletes every stored message, after a confirm dialog. Before, it only hid them in that browser (a localStorage cutoff, [#38](https://github.com/tuann72/HackUTD/pull/38)), and that code is removed along with "Show N cleared". Both backends serve `DELETE /api/messages`: the VM gateway (SQLite, the same wipe as `POST /debug/reset`, CORS now allows DELETE) and the Vercel backup (`deleteMany` on the Atlas `inbox` collection). The page calls whichever one `NEXT_PUBLIC_API_URL` points at. In replay mode, clearing empties the mock list and the replay keeps going.
- **Why:** Tuan asked for the button to clear the data, not just hide it.
- **Trade-offs, accepted by Tuan:** this is the first write from the web app to the gateway, an exception to the one-way decoupling rule (`AGENTS.md`). It has **no authentication**, so anyone who opens the public page can wipe the inbox, judges included. A token prompt was offered and declined.

### 2026-11-08: Potential Threat synthetic dataset (proposal)

- **Problem (Tuan):** the classifier handles threat and coercion texts badly, for example "MOM IM DYING RIGHT NOW GIVE ME $900 OR I EXPLODE" and "YOUR WIFFE IS IN DANGER GIVE ME 500$".
- **Why (coverage check, Claude Code):** the training data has almost no such texts. Kidnap/ransom/hostage words appear in 86 rows, mostly Enron spam noise labeled Health or Internet; "or else / I know where you live" in 34, mostly eBay phishing and ham; "hitman" in 2 ham rows. "Hi mum/dad" family-emergency scams exist (143 rows, 139 of them label 1, all synthetic) but carry no threat. No short ALL-CAPS text has a money amount, and 215 of 239 short ALL-CAPS texts are ham, so caps likely pushes toward ham.
- **What (proposal):** `data/build_threat_synthetic.py`, a seeded, stdlib-only template generator, writes `data/potential_threat_synthetic.csv` (4,100 train rows: 2,650 with a new label **8 "Potential Threat"**, 1,450 hard negatives labeled ham) and `data/potential_threat_eval.csv` (100 held-out hand-written-style rows, `split = threat_eval`, including Tuan's two examples). Hard negatives get the same caps, typo and emoji noise so the model can't learn "caps = threat". All rows are synthetic and in `train`, so `val`/`test` stay 100% real. Details and caveats: `data/README.md`, section 4.
- **Not changed:** the four 100k CSVs, `data/scam_categories.csv` (a 9th row would change `train.py`'s label names and break `classifier/tests/test_offline.py`), and all code in `classifier/`, `services/`, `apps/` and `contracts/`. The changes needed to train and serve a 9th class are listed in [`docs/features/potential-threat-data.md`](docs/features/potential-threat-data.md), stage 2.
- **Still TBD:** binary vs. 8-class vs. 9-class (or folding threats into label 1, Imposter & Phishing); how the extra file joins training; whether the gateway warns instead of blocks for this class (self-harm coercion); and whether to add real or LLM-written threat examples to reduce template overfitting.

### 2026-11-08: Stacked model option built (`train.py --model stacked`)

- **What (Timothy + Claude Code, task 1.5):** the stacked flow recommended in the entry below is now a third model kind. `train.py --model stacked` trains TF-IDF + LR and MiniLM + LR on `train`, then the stacker (a small LR on both models' 16 class log-probabilities) on the real `val` split, and writes `head.joblib` (the stacker), `tfidf_head.joblib`, `minilm_head.joblib`, `vectorizer.joblib` and `keywords.json`. The service loads `kind: stacked-lr` from `model.json` and needs no API change, so the gateway can't tell which model is behind it.
- **Highlights:** by occlusion through the whole stack (drop a word, re-score both models), so they explain the score actually returned. TF-IDF-only coefficient highlights would have been cheaper but would ignore the MiniLM half.
- **Val does double duty, handled:** the stacker is fit on all of `val`, but the suggested thresholds in `metrics.json` are picked from 5-fold out-of-fold stacker scores on `val`, then checked on `test`. Val metrics for a stacked model are in-sample; judge it on test.
- **Verified (laptop RTX 3050, full data, 8-class):** featurize 328 s, fit 168 s. Run through the service's own code path, the saved model reproduces the comparison exactly: at score ≥ 0.5 on test, 26 false blocks, 33 missed scams, SMS F1 0.952, ECE 0.008. `tests/test_service.py` passes (4/4). CPU latency on the laptop: about 70 ms for a scam with highlights, 29 ms for a legit message.
- **Suggested thresholds** (picked on val, checked on test): **0.19** gives 97.1% precision and 99.3% recall; **0.75** gives 98.9% precision and 96.9% recall. These are inputs for the gateway's `BLOCK_THRESHOLD` (and a possible Nemotron review band), not a decision.
- **Note on `train.py` metrics:** they count a message as scam when its top class isn't Ham, while the service uses P(scam) ≥ 0.5. For the stacked model that gives 22 false blocks / 39 missed on test instead of the service's 26 / 33. This was already true for the other kinds; the gateway sees the service's numbers.
- **Deployed (Timothy, 2026-11-08):** the stacked model runs on the gateway's Vultr VM (the `MODE=shared` layout, Tuan informed): a Docker container on `127.0.0.1:8000`, token in `/etc/tgate/classifier.env`, and the gateway calls it over loopback. Artifacts came from the laptop run, so the Vultr GPU wasn't used. On the VM's one CPU, with a 2 GB plan: about 120 ms for a scam with highlights, 30 ms for a legit message. `BLOCK_THRESHOLD` stays 0.5.
- **Still TBD:** whether stacked formally replaces MiniLM as the agreed model, the block threshold, and binary vs. 8-class labels.

### 2026-11-07: TF-IDF vs. MiniLM, combined flows and zero-day test

- **What ran (Timothy, laptop RTX 3050):** classifier task 2.1's full training runs on `data/scam_categories_100k_full.csv`, 8-class labels, for both models, then two experiments: [`classifier/experiments/compare.py`](classifier/experiments/compare.py) and [`zeroday.py`](classifier/experiments/zeroday.py). Everything tuned or fit is fit on the real `val` split; numbers below are the real `test` split (3,155 messages, 607 of them SMS). Both models pass `tests/test_service.py`. Binary-label runs are not done yet.
- **Earlier numbers:** the MiniLM result going around (scam-vs-ham F1 0.949, macro-F1 0.80) is the 5k-row Mac smoke test, not a full run.

**Each model alone (`train.py` metrics, full data):**

| Test split | TF-IDF + LR | MiniLM + LR |
|---|---|---|
| Scam vs. ham precision / recall / F1 | 0.984 / 0.980 / **0.982** | 0.935 / 0.979 / 0.957 |
| SMS-only scam vs. ham F1 | **0.936** | 0.875 |
| 8-class accuracy / macro-F1 | **0.947 / 0.908** | 0.888 / 0.823 |
| Train time (laptop) | 109 s features + 221 s fit, CPU | 311 s embeddings (GPU) + 43 s fit |

TF-IDF wins every category, most on Imposter & Phishing (F1 0.852 vs 0.713).

**Combined flows** (scam score = 1 − P(Ham), cutoff 0.5):

| Setup | Precision | Recall | False blocks | Missed scams | SMS F1 | Calibration error (ECE) |
|---|---|---|---|---|---|---|
| TF-IDF + LR | 0.973 | 0.988 | 42 | 18 | 0.917 | 0.025 |
| MiniLM + LR | 0.923 | 0.984 | 125 | 24 | 0.852 | 0.040 |
| Average (0.8 TF-IDF + 0.2 MiniLM) | 0.976 | 0.990 | 37 | 15 | 0.935 | 0.031 |
| Cascade (MiniLM only when TF-IDF score is 0.05–0.60, 14% of messages) | 0.976 | 0.990 | 37 | 15 | 0.935 | 0.027 |
| TF-IDF recalibrated on `val` | 0.980 | 0.983 | 30 | 26 | 0.929 | **0.005** |
| **Stacked** (small LR on both models' log-probabilities, fit on `val`) | **0.983** | 0.978 | **26** | 33 | **0.952** | 0.007 |

On known scam categories the combinations gain only a few messages over TF-IDF alone, and most of the stacked model's calibration gain comes from refitting on real data (the recalibrated TF-IDF row).

**Zero-day test:** for each of the 7 scam categories, both models were retrained as scam/ham with that whole category removed from training (and from the TF-IDF vocabulary); anything fit on `val` also excluded it. Recall on the never-seen category, test split, weighted by category size (1,526 messages over the 7 runs):

| Setup | Unseen category caught (cutoff 0.5) | Unseen category caught (97%-precision threshold) | False blocks on ham |
|---|---|---|---|
| **Stacked** | **0.902** | **0.954** | **1.3%** |
| Cascade | 0.900 | 0.950 | 1.6% |
| Average | 0.898 | 0.950 | 1.5% |
| TF-IDF + LR | 0.885 | 0.927 | 1.6% |
| TF-IDF recalibrated | 0.880 | 0.927 | 1.5% |
| MiniLM + LR | 0.874 | 0.771 | 4.4% |

Adding MiniLM catches about 2.5 points more of a brand-new scam type (about 40 more messages here) with no more false blocks. It helps in 6 of 7 hold-outs; the exception is Jobs, Business & Investment (TF-IDF 0.925, stacked 0.868). MiniLM alone is the weakest setup everywhere.

- **Recommendation (Timothy, proposed):** ship the **stacked** flow. TF-IDF + LR and MiniLM + LR both score every message, and a small LR fit on real `val` data combines them into one risk score. It has the best calibration of the combined flows (needed for a risk-score threshold), the fewest false blocks, the best SMS F1, and the best zero-day recall. The cascade is the fallback if MiniLM's CPU cost is a problem: same zero-day recall, MiniLM on only ~14% of messages, but less honest scores.
- **Not built yet:** the service serves one model at a time. The stacked flow needs `train.py` to write both models plus the combiner, and `service/app.py` to load all three. `val` currently does double duty (combiner fit and threshold choice); split it in half when this is built.
- **Still TBD:** binary vs. 8-class labels for the service, and the block threshold.

### 2026-11-08: VM gateway accepts Photon 2.0 / Beta webhooks

- **Why (Timothy):** the team's Photon project is on Beta, and the goal is iPhone → Photon → Vultr gateway → classifier. The gateway only spoke Stable Spectrum, so it would have rejected every Beta delivery.
- **What:** `POST /webhooks/photon` now verifies Standard Webhooks signatures (`webhook-id`, `webhook-timestamp`, `webhook-signature`, `whsec_` secret) when those headers are present and parses `message.received` envelopes. Stable `X-Spectrum-*` deliveries and the simulator work as before. Both paths check `PHOTON_WEBHOOK_SECRET`, and neither can be skipped. The Beta field names come from `api.photon.codes/openapi.json`.
- **Beta differences:** attachment events carry only an id, so the name, type and size are null. Reactions have no target preview. Voice, read receipts and typing events are acknowledged and ignored.
- **Same handling as Vercel:** signature check and `message.received` parsing follow `apps/web/lib/server/inbox.ts`, and a signed event the gateway can't use is acked with a 200 so Photon doesn't retry it. Still different by design: the VM stores in SQLite and classifies after the 200.
- **Procedures:** `DEPLOY.md` step 6, `docs/SETUP.md` and the gateway README now describe the Beta flow. The VM's webhook URL is `https://149-28-243-66.sslip.io/webhooks/photon`. The hostname is a stopgap from sslip.io, so it needs no DNS; a change of VM IP means re-registering.
- **Verified:** `test/photon-beta.test.ts` (8 tests) with synthetic signed events. A real iMessage then went iPhone → Photon Beta → VM and was stored and scored (still `stub@0`; the classifier is not deployed yet).
- **Still open:** a Beta project can deliver to both the VM and the Vercel backup route. Which destinations stay registered, and which one `NEXT_PUBLIC_API_URL` reads, is for the team to settle.

### 2026-11-08: Voice scam guard feasibility and staged plan (proposal)

- **User request:** explore a call guard that transcribes the caller, sends transcript text to the classifier, and shows a warning in the Vercel app. Keep it separate from the current iMessage MVP.
- **Interview direction:** first have a human tester call the Photon voice number, capture caller speech, classify after hangup, and retain transcript plus verdict without retaining raw audio. The main follow-up is live classification and a warning during the call. A later stage bridges the caller to a human victim while the guard monitors the caller's audio. The exact victim endpoint remains TBD.
- **Feasibility:** Photon voice is routed through SIP to a voice application; a normal Photon message webhook does not carry call audio. Photon Stable Spectrum currently marks voice webhooks as coming soon and says calls are not available in `app.messages` or `app.webhook()` ([voice docs](https://photon.codes/docs/spectrum-ts/providers/voice)). Photon 2.0/Beta documents routing inbound calls over SIP into a LiveKit room ([LiveKit cookbook](https://photon.codes/docs/beta/cookbooks/voice/livekit)), where an app can process the audio track. Therefore this is feasible if the call is routed through the Photon voice line and SIP media path; direct calls that bypass this route are not observable by T-Guard.
- **Recommended path (inference):** Photon 2.0/Beta Voice profile → SIP → LiveKit → speech-to-text → existing `POST /classify` → read-only call-result API/contract → Vercel UI. This matches the repository's Photon 2.0/Beta webhook integration and the published LiveKit cookbook; confirm the team's line and product version before implementation.
- **Important line constraint:** Photon 2.0/Beta docs say shared iMessage assignments do not support Voice. The repository's existing iMessage number is shared-pool; the voice number the user set up must be verified separately. No call audio or raw phone handles should be sent to the classifier.
- **Classifier limitation:** the existing model is trained on text messages, not call transcripts. The MiniLM inference path truncates at 256 tokens, so long-call windowing, aggregation, and call-level evaluation are required before live thresholds can be trusted.
- **Current account context:** the latest gateway work confirms the team's Photon project uses Photon 2.0/Beta. Whether the voice number is assigned to that project and is eligible for Voice remains to be checked.
- **Plan:** [`docs/features/voice-scam-guard.md`](docs/features/voice-scam-guard.md) and [interview master spec](.plans/voice-scam-guard-spec.md). Voice-number eligibility, STT provider, transcript retention period, caller/victim bridge, live transport, and warning threshold remain TBD.

### 2026-11-08: Classifier tests without artifacts; one-command Vultr scripts (proposal for hosting)

- **Done:** `classifier/tests/test_offline.py` runs with no trained model, GPU, PyTorch or download. It trains a tiny TF-IDF model on synthetic rows, fakes the MiniLM encoder for occlusion, and checks the service against the gateway's `parseVerdict` expectations. `classifier/vultr/train_gpu.sh` and `deploy_inference.sh` automate README steps 1–2 through the Vultr API. They're **not yet run against a real account**.
- **Training:** the GPU instance is created and deleted by one script, with a `trap` so it's also deleted on failure or Ctrl-C. It asks before creating anything that costs money.
- **Proposal, not decided:** where the classifier runs. `MODE=shared` puts it on the gateway's VM, bound to `127.0.0.1:8000`, and the gateway calls it over loopback with the token. That's one server and no public classifier URL, but it needs ≥ 2 GB RAM. It adapts Timothy's unmerged one-server commit `d28ebd5` to the systemd gateway on `main`. `MODE=separate` keeps the existing own-server Compose and Caddy setup. Over loopback, the gateway reaches the classifier over plain HTTP on the same host, not HTTPS. Tuan to pick.
- **Inputs needed:** `VULTR_API_KEY` (in the shell only), region, GPU plan (`train_gpu.sh --list`), budget, and the hosting `MODE`.

### 2026-11-08: Block the message, not the sender; sender blocklist parked (off by default)

- **Decision (Tuan):** "we don't aim to block users, just block that instance of a message." This overrides the sender-level blocking in Timothy's plan ([`sender-blocklist.md`](docs/features/sender-blocklist.md)). Each message is judged on its own by the classifier. A scam sender's next legit message is delivered.
- **What stays:** the blocklist module and its wiring, behind `SENDER_BLOCKLIST` (`off`|`on`, **default `off`**). With it off, there are no blocklist calls, no fingerprint or strike recording and no Atlas connection, even with `MONGODB_URI` set (a log line says it's ignored), and `MONGODB_URI`/`FINGERPRINT_SECRET` aren't validated. `on` keeps the previous behavior as a parked option.
- **Override:** renamed to `POST /admin/messages/restore` and `npm run message:restore`, still behind `ADMIN_TOKEN`. It restores **only the named message** (reason `override`). It allowlists the sender only when the blocklist is on.
- **Contract:** `sender_blocked` stays in v1 (valid when on) but isn't emitted by default. `override` is unchanged.
- **Kept:** the `src/handle.ts` email normalization (it also makes participants consistent).
- **Superseded:** the "proposals needing Tuan" in the entry below. Proposal 1 (block a blocklisted sender's text-less content) only applies when on. Proposal 3 is reversed: restore one message, not all.

### 2026-11-08: Sender blocklist wired into the gateway flow (proposals need Tuan)

- **Built (`feat/sender-blocklist-gateway-flow`):** sender-blocklist tasks 1.1, 2.1 and 2.2 and photon-imessage task 1.5. After the webhook's `200`, the gateway checks the blocklist first. A blocklisted sender's message is `blocked` with reason `sender_blocked`, without a classifier call. Every model block records sender and text fingerprints, with strikes, very-high-score and TTL rules at the existing defaults. Atlas errors are logged and ignored (fail open). Without `MONGODB_URI`, a `MemoryBlocklist` with a per-process key is used.
- **Handles:** fingerprints use the same normalization as participants (`src/handle.ts`). Email handles are lowercased, so `Scammer@iCloud.com` and `scammer@icloud.com` are one sender. Before this, `normalizeNumber` reduced every email handle to an empty string, which would have made all email senders one fingerprint.
- **Contract (additive, v1):** new reasons `sender_blocked` (`verdict: null`) and `override` (a person said "Not a scam"; the verdict is kept). The web app shows "Blocked: known scam sender" and "Restored".
- **Proposals needing Tuan's confirmation:**
  1. Text-less content (attachments, reactions, contact cards) from a blocklisted sender is **blocked**, not delivered unchecked.
  2. The override is an **operator tool**: `POST /admin/senders/allow` with its own `ADMIN_TOKEN`, separate from `DEBUG_TOKEN` so it can run on the public VM with debug off, plus `npm run sender:allow -- <msg id>`. It's not a web button, which keeps the one-way data rule.
  3. The override restores **all** of the sender's blocked messages, not just the one named.
- **SQLite:** the reason CHECK constraint changed. A database from before this change is refused at startup (`npm run db:reset`).

### 2026-11-08: Shared-pool Photon number, not a dedicated line

- **Correction (Tuan):** the team isn't on Photon's Business plan. The victim line is the **shared-pool number** the project gets on Free/Pro. No code change: the gateway never filters on `space.phone`, and webhooks only carry our project's conversations.
- **Consequences:** no real group chats (the UI support stays for the simulator); quotas of 50 new conversations per line per day and 5,000 messages per day (a live-demo risk); and whether arbitrary iPhones can reach the project is undocumented. Test this before the demo.

### 2026-11-08: Photon track, dedicated line, rich iMessage content, virtual inbox

- **Decisions (Tuan):**
  1. Enter the **Photon track**.
  2. Use one **dedicated** Photon line, so there's no shared-pool filtering. *(Superseded the same day: shared-pool number, see above.)*
  3. **Show attachments, reactions, contact cards and group chats** in the UI.
  4. Keep the victim's inbox **virtual** (the web UI), as with Twilio.
- **Contract (additive, still v1):** new optional message fields `kind`, `conversation {id, type}`, `attachments [{name, mimeType, size}]`, `reaction {emoji, targetPreview}` and `contact {name, phones}`, plus a new reason, `not_classified`. They're optional so older v1 data stays valid. The gateway always sends them. Contact-card phones are masked, and Photon's attachment GUIDs and `space.id` never leave the gateway.
- **Policy:** content with no text (attachment, reaction, contact card, photo-only album) is **delivered unchecked** and shown as "Not checked". The model reads text only. Blocking a known scam sender's attachments waits on the sender blocklist (photon-imessage task 1.5).
- **UI:** the card shows attachment chips, the reaction emoji and target preview, the contact card and a "Group chat" badge. On blocked messages these are defanged like the body. The scene labels non-text messages with a short summary.

### 2026-11-08: iMessage through Photon replaces Twilio SMS

- **Decision (Tuan):** migrate to **Photon (Spectrum)** and handle **only iMessage**. The gateway's `POST /twilio/sms` is replaced by `POST /webhooks/photon`. The `twilio` package is removed from the gateway and the simulator. This reverses "Photon dropped" (2026-11-07) for the messaging provider. Whether the team enters a Photon track is TBD. Plan: [`docs/features/photon-imessage.md`](docs/features/photon-imessage.md).
- **Webhook:** JSON `messages` events. The signature is `X-Spectrum-Signature: v0=` + HMAC-SHA256(signing secret, `v0:<X-Spectrum-Timestamp>:<raw body>`), with a 300 s replay window ([Photon docs](https://photon.codes/docs/webhooks/verifying-signatures)). The URL isn't signed, so `PUBLIC_WEBHOOK_URL` is removed. Responses: `400` for missing headers, a stale timestamp or a malformed body; `401` for a bad signature; `200 ok` for everything else, including duplicates and ignored content, so Photon (which retries 5xx, 408 and 429 up to 6 times) doesn't retry them.
- **Verified by hand, not with Photon's SDK:** about 20 lines of `node:crypto` keep the gateway free of a provider SDK and let tests and the simulator sign requests the same way. `spectrum-ts` and its Hono adapter exist and could replace this later.
- **Data:** dedupe on Photon's `message.id`. Participants are keyed by iMessage handle (an E.164 number or an Apple ID email), normalized and masked (`***-***-0142`, `j***@icloud.com`). The query API contract is unchanged. The SQLite schema changed, and the gateway refuses to open an old Twilio-schema file.
- **Content:** `text`, `richlink` (its URL) and `group` (joined items) are classified. `attachment`, `reaction` and `contact` are acknowledged and ignored (TBD).
- **Hosting:** Photon delivers only to public HTTPS URLs with no redirects, which fits the Vultr VM behind Caddy. Real messages on a laptop need a tunnel. The simulator still posts to `localhost`.
- **Still TBD:** dedicated vs. shared line, what "blocked" means on a real victim handset, attachments and group chats, and wiring the sender blocklist on email handles.

### 2026-11-08: Sender blocklist and scam fingerprints in MongoDB Atlas

- **Decision (Timothy):** Vultr is the judge: the classifier on Vultr scores each message and the gateway blocks it at `BLOCK_THRESHOLD`, as before. New: each blocked message records a **fingerprint** in **MongoDB Atlas**, and proven scam senders go on a **blocklist** so their later messages are blocked without the model (reason `sender_blocked`). Plan: [`docs/features/sender-blocklist.md`](docs/features/sender-blocklist.md).
- **Fingerprint:** HMAC-SHA256 with a gateway-only secret, of the sender's E.164 number and of the normalized message text, plus score, category, model, strikes and timestamps. Atlas never sees raw numbers or text, which keeps the "no raw numbers outside the gateway" rule.
- **Protecting innocent senders:** the classifier misjudges roughly 1–1.5% of legitimate messages, and scammers spoof real numbers. So a sender is blocklisted only after several scam messages (default 3) or one very high score (default 0.95); blocks expire (default 7 days); and a "Not a scam" override allowlists the sender. Defaults are **TBD**.
- **Storage:** SQLite stays the inbox and blocked log (Tuan's decision). Atlas holds only fingerprints and the blocklist, and fails open: if it's unreachable, messages are classified as usual.
- **Still TBD:** where the override lives (the web app may not write to the gateway), the contract change (`sender_blocked`), the defaults, Atlas tier/region.

### 2026-11-07: Scene and message list on one page; 2D bubble image

- **Decision (Tuan):** combine the initial scene and the message list into **one page at `/`**: the scene band on top, the inbox and blocked lists below. `/messages` and `/scene` redirect to `/` (temporary redirects, in case the routes split again).
- **One data source:** the scene now animates the same `useMessages` poll as the lists. Each message fires a shot when it resolves to delivered or blocked, so the scene and the lists always show the same messages. This replaces the scene's hand-written fake messages and, for the polling MVP, covers what task 4.1 of the scene plan wanted (live data); an event stream is still later scope. With no `NEXT_PUBLIC_API_URL`, both run on the mock replay.
- **Decision (Tuan):** the message projectile is a **flat 2D chat-bubble image** (a camera-facing sprite from `apps/web/public/scene/bubble.svg` and `bubble-scam.svg`) instead of a 3D ball. Swapping the art means replacing those files.
- **Unchanged:** the scene still renders the gateway's `action` and verdict and never decides anything itself. Labels under the bubbles are defanged like the list.

### 2026-11-07: Gateway on a Vultr VM, web app on Vercel

- **Decision (Tuan):** the gateway runs on a **Vultr VM** (option A in the Twilio MVP plan). Only `apps/web` deploys to **Vercel**, through a repo-root `vercel.json` with one service (`web`) that serves every path. The classifier stays on Vultr as agreed.
- **Why not all on Vercel:** a suggested multi-service `vercel.json` (web, gateway, classifier) was considered and rejected. The gateway keeps messages in a local SQLite file and classifies after replying to Twilio; neither survives Vercel functions. MiniLM's `torch` and `sentence-transformers` are too large for a Vercel Python function. Keeping the gateway off Vercel also keeps the rule that a web deploy can't break interception.
- **Consequences:** no Vercel service bindings, since the browser calls the gateway directly at `NEXT_PUBLIC_API_URL`. The gateway needs an **HTTPS** URL (the Vercel page is HTTPS) and the Vercel domain in `CORS_ORIGINS`. Twilio's webhook points at `https://<gateway-host>/twilio/sms`, matching `PUBLIC_WEBHOOK_URL`.
- **Still TBD:** the VM size and region, the domain, and how HTTPS is terminated on the VM (for example Caddy).

### 2026-11-07: MVP implementation decisions

- **Decisions (Tuan):** the Twilio MVP is being built now, so the scaffolding hold is lifted for the gateway, simulator and message UI. Gateway storage is **SQLite** (`node:sqlite`), with debug tools to clear it. When the classifier is down, the gateway **fails open**: it delivers the message with `reason: classifier_unavailable`, and the UI shows it as unverified. The message bank and scenarios are **JSONL**. The message UI is the **`/messages`** route in `apps/web`, leaving `/` for the 3D scene.
- **Contract:** the read-only query API is defined in `contracts/query-api.v1.schema.json`, with sample fixtures. It's the only thing the gateway and web app share.
- **Each package is standalone** (its own `package.json` and lockfile, no npm workspaces), so parallel branches don't conflict on a shared lockfile and each deploys alone.

### 2026-11-07: TF-IDF + LR implemented alongside MiniLM

- **Change (Tuan):** `classifier/train.py --model tfidf` trains TF-IDF (word unigrams and bigrams) + logistic regression on the same data and splits as MiniLM. The same service serves it (`model.json` `kind` is `tfidf-lr`) behind the same `/classify` contract.
- **Not a change of plan:** MiniLM on Vultr is still the planned model. TF-IDF is the baseline to compare against and a fallback if MiniLM falls short or is too slow.
- **Why:** comparing the two needs both trained and scored the same way. TF-IDF needs no GPU (it can train on the inference server), and its highlights are exact: each word's TF-IDF value × its weight toward the predicted scam class vs Ham, with bigram contributions split between their two words. See [Keyword highlighting](#keyword-highlighting).
- **Extra:** TF-IDF training also writes `keywords.json`, the top 15 "words to watch" per scam category.
- **Still TBD:** which model ships, and the label scheme. Both are decided after both models' full runs.

### 2026-11-07: Hono for the gateway

- **Decision (Tuan):** the gateway is a TypeScript service built with [Hono](https://hono.dev).
- **Why:** the gateway is only a couple of routes, but a framework saves hand-writing routing, form-body parsing (Twilio posts form-encoded data), CORS and error handling. Hono is small, TypeScript-first, and its apps can be tested in memory (`app.request(...)`) without starting a server. Plain `node:http`, Express and Fastify were the alternatives.
- **Still TBD:** where the gateway is hosted.

### 2026-11-07: TypeScript for the Twilio stack; `DESIGN.md` renamed to `CHANGELOG.md`

- **Decision (Tuan):** the gateway (Twilio webhook and query API) and the perpetrator simulator are TypeScript, as is the Next.js web app. This confirms the earlier lean. The classifier's training and inference stay Python.
- **Why:** one language across the Twilio side and the web app. Twilio's `twilio` npm package has TypeScript types, `validateRequest` for checking webhook signatures and `getExpectedTwilioSignature` for signing simulator requests. The only realistic alternative was Python (FastAPI), which would split the backend from the web app.
- **Still TBD:** the gateway framework (later: Hono, see above) and where it's hosted.
- **Also:** this file was renamed from `DESIGN.md`.

### 2026-11-07: Initial 3D scene is two blobs and message shots (later scope)

- **Decision (Tuan):** when the parked scene is picked up, start with one **pink victim blob** and one **sender blob that shoots messages** at it. **Red** messages are flagged as a **potential scam**. Each message goes through to the victim or gets blocked and pops before it arrives. On-screen wording says "potential scam", never "scam".
- **Why:** it's the simplest picture that shows T-Guard stopping potential scams while letting other messages through.
- **Doesn't change:** the scene stays parked until the MVP works. The fuller scene below (crowd of blobs, chat bubbles) stays proposed.
- **Details:** [`docs/features/initial-3d-scene.md`](docs/features/initial-3d-scene.md).
- **Update:** built early in #14 at `/scene` with fake messages, before the MVP was finished. Live data is still to come.

### 2026-11-07: MVP UI is a basic Next.js message list; 3D scene parked

- **Decision (Tuan):** the MVP UI is a basic Next.js page that shows delivered and blocked messages, polling a read-only `GET /api/messages`. The React Three Fiber scene, event stream, scam notice and blocked-scams panel move to later scope.
- **Why:** focus on getting the Twilio path working end to end first.
- **Also recorded:** a tunnel is needed only when a real phone texts a gateway running on a laptop; the simulator posts to `localhost`, and a deployed gateway has a public URL. Recommended: deploy the gateway early. Gateway hosting (separate service vs. Next.js route handlers on Vercel) is still TBD, with a separate service recommended.
- **Details:** [`docs/features/twilio-mvp.md`](docs/features/twilio-mvp.md).

Newest first. Each entry: date, decision, rationale, and what it replaces.

### 2026-11-07: MiniLM, trained and served on Vultr; Vultr track added

- **Decision (Tuan):** the classifier is **MiniLM** (frozen `all-MiniLM-L6-v2` embeddings + logistic-regression head). It's **trained on a Vultr Cloud GPU** and **served from Vultr Cloud Compute** as a CPU FastAPI service. The project now also enters the **Vultr** track.
- **Replaces:** "Classifier candidates" and "Considering Vultr for the model" below, for the classifier and its hosting. TF-IDF + LR becomes the baseline to beat, not the plan.
- **Rationale:** the team has Vultr credits, and Vultr hosting fulfills a track. MiniLM may generalize better to paraphrased scam wording than TF-IDF. A GPU isn't needed for inference: a CPU takes about 15–120 ms per message, including highlights.
- **First result (smoke test, 5k train rows, Mac):** 8-class head, real test split: scam-vs-ham F1 0.949, macro-F1 0.80. A full-data run on Vultr is next.
- **Consequences:** keyword highlights use occlusion instead of TF-IDF coefficients. Fine-tuning is a fallback. Label scheme and thresholds are still TBD.
- **Details:** [Classifier service on Vultr](#classifier-service-on-vultr), [`classifier/README.md`](classifier/README.md), [`docs/features/classifier-service.md`](docs/features/classifier-service.md).

### 2026-11-07: React Three Fiber and Motion for the web app

- **Decision (Tuan):** build the 3D scene with **React Three Fiber** (`@react-three/fiber`, plus `@react-three/drei` helpers) instead of plain Three.js, and use the **Motion** library ([motion.dev](https://motion.dev/), the `motion` package) for animation.
- **Rationale:** R3F fits a React/Next.js codebase. The scene is written as React components, shares state and tooling with the rest of the app, and still uses Three.js underneath.
- **How Motion fits:** use `motion/react` for everything that's DOM: chat bubbles (rendered as HTML over the scene with drei's `<Html>`), the blocked-scams panel, notice toasts and page transitions. **Don't use `framer-motion-3d`** to animate 3D objects. That package is deprecated on npm, and Motion's own R3F docs say it's only compatible with React 18. Current Next.js uses React 19. Animate the blobs in R3F instead (`useFrame` with damping, for example `maath`'s `easing.damp3`). `@react-spring/three` is an alternative if that gets awkward.
- **Replaces:** "CSS2DRenderer or canvas sprites" and "plain Three.js vs. React Three Fiber" in the scene's open questions.

### 2026-11-07: Safe Signal track only; Photon dropped

- **Decision (Tuan, for now):** focus only on the **Safe Signal (T-Mobile)** track. Photon is dropped.
- **Replaces:** the SRS's two tracks (Safe Signal and Photon) and the open question about which one is primary.
- **Rationale:** not recorded yet. A carrier-side scam filter that blocks messages before they reach the subscriber fits Safe Signal directly.

### 2026-11-07: Android app dropped

- **Decision (Tuan):** there will be no Android app. The victim-facing experience is the scam notice plus the Next.js web app.
- **Replaces:** "Android is deferred" in "Twilio-first MVP" below, and the SRS's Android, text-first MVP.

### 2026-11-07: Training data is `scam_categories_100k_full.csv`

- **Decision (Tuan):** train the model on the most aggregated labeled dataset, [`data/scam_categories_100k_full.csv`](data/README.md#scam_categories_100k_fullcsv). It has all 100k messages, the 8-class label (`label_class`: 0 = ham, 1–7 = scam groups), the binary `is_spam` label, and the metadata (`split`, `style`, `is_synthetic`, `label_method`, `label_confidence`).
- **Why this file:** it supports both label schemes (binary via `is_spam`, category via `label_class`) from one source. The category is needed for block reasons. The metadata lets training filter or weight rows (for example, by `label_confidence`), and evaluation can stick to the real `val`/`test` splits.
- **Separate from the message bank:** the message bank is demo and test input drawn from the `test` split and generated messages. It isn't training data. See [Message bank](#message-bank).
- **Still TBD:** binary vs. 8-class model, and whether low-confidence or template-synthetic rows are filtered.

### 2026-11-07: Leaning TypeScript; proposed scam notice, blocked-scams panel and keyword highlights

- **Stack (Tuan's lean, not final):** TypeScript for the gateway, the perpetrator simulator and the Next.js web app. The model training and inference service stays Python. See [Technology stack](#technology-stack-typescript).
- **Proposed:** when a scam is blocked, the victim gets a short notice ("T-Guard blocked a potential scam… View: <link>"). The link opens a **blocked-scams panel** in the Next.js app that lists every blocked message, why it was blocked and its category. The panel **highlights the keywords** that pushed the model toward "scam", so the victim learns to spot them in messages that get through.
- **Details:** [Scam notice to the victim](#scam-notice-to-the-victim), [Blocked-scams panel](#blocked-scams-panel), [Keyword highlighting](#keyword-highlighting).

### 2026-11-07: One Twilio number, simulated perpetrator

- **Decision (Tuan):** the MVP uses **one** Twilio number, the victim number. The perpetrator is simulated: a script sends signed, Twilio-format inbound-SMS requests straight to the gateway's webhook. The simulator draws messages from a **message bank** of labeled examples (a subset of the `data/` test split and/or generated messages; mix TBD).
- **Replaces:** the two-number plan in "Twilio-first MVP" below.
- **Rationale:** Twilio can't send a message from a number to itself, but it doesn't need to. To the gateway, an inbound SMS is just an HTTP POST, so a simulator can produce the same request. This avoids a second number, outbound message fees, A2P 10DLC or toll-free registration for the perpetrator's texts, and trial-account sending limits. Simulated sends are instant and replayable. The real Twilio path is still checked by texting the victim number from a real phone.
- **Details:** see [Perpetrator simulator](#perpetrator-simulator) and [Message bank](#message-bank).

### 2026-11-07: Considering Vultr for the model, and Next.js on Vercel for the scene

- **Status:** under consideration (Tuan), not agreed.
- **Vultr:** considered for training the classifier and for hosting it as an inference service. The gateway sends each intercepted message to the Vultr-hosted model, gets a verdict back, and blocks or delivers based on it.
- **Block tracking:** every blocked message is recorded with **why** it was blocked: scam category, score, model version and time.
- **Scene hosting:** the Three.js scene would be a Next.js website, deployable on Vercel.
- **Rationale:** not recorded yet. Vultr offers cloud GPU and compute for training and serving. Next.js on Vercel is a quick way to put the scene on a public URL.
- **Details:** see [Classifier service on Vultr](#classifier-service-on-vultr), [Blocked-message tracking](#blocked-message-tracking) and [Scene hosting](#scene-hosting-nextjs-on-vercel-under-consideration).

### 2026-11-07: Proposed interception gateway and decoupled demo scene

- **Status:** proposed by Tuan, not yet agreed by the team.
- **Proposal:** the gateway intercepts every message sent to the victim number, classifies it, then delivers it to a virtual victim inbox or blocks it. It publishes versioned JSON events that any display can consume. The first display is a simple Three.js scene (blob people with chat bubbles).
- **Firm requirements from Tuan:** the Twilio/interception side and the Three.js scene must be fully decoupled, sharing only the event contract. The scene stays simple.
- **Rationale:** blocking happens in our own code, so it needs no outbound SMS and avoids trial and A2P 10DLC limits. Decoupling lets the pipeline and scene be built, tested and demoed in parallel, and a display failure can never affect a block decision.
- **Details:** see [Proposal: Twilio interception gateway and decoupled demo scene](#proposal-twilio-interception-gateway-and-decoupled-demo-scene).

### 2026-11-07: Classifier candidates

- **Decision:** two approaches are under consideration: TF-IDF + logistic regression (leading), and a MiniLM-based model. Neither is final.
- **Rationale:** TF-IDF + logistic regression is fast, simple, and already has a strong binary baseline on the `data/` dataset (F1 ≈ 0.98, real test split). MiniLM may handle paraphrased or novel scam wording better.
- **Still to decide:** final choice, label scheme (binary or 8-class), evaluation measures, thresholds, and where the model runs.

### 2026-11-07: Twilio-first MVP

- **Decision:** the MVP uses two team-owned Twilio numbers, one as the victim and one as the perpetrator, to simulate a conversation. Messages the victim receives are classified as scam or legitimate.
- **Later:** a live public demo where anyone can text the victim number and see their messages appear and get classified in real time.
- **Replaces:** the SRS's Android, text-first MVP. Android was deferred at the time and has since been dropped (see "Android app dropped" above).
- **Rationale:** not recorded yet.
- **Partly superseded:** the two-number setup was replaced by one number plus a simulated perpetrator (see "One Twilio number, simulated perpetrator" above).

### 2026-11-07: Project renamed to T-Gate

- **Decision:** the project is called T-Gate, replacing the working name "Gate Guardian".
- **Superseded:** renamed to T-Guard on 2026-11-08 (see "Project renamed to T-Guard" above).

## Architecture

**TBD (not agreed).** See the open questions in `AGENTS.md` and `docs/features/twilio-mvp.md`. The proposal below is the current candidate.

### Proposal: Twilio interception gateway and decoupled demo scene

**Status: proposed, not agreed.** Drafted 2026-11-07 for Tuan. Two requirements come from Tuan and are firm: the Twilio/interception side and the 3D scene (now React Three Fiber) must be **fully decoupled** (no hard dependency in either direction), and the scene must stay **simple** (blob people moving and talking, with a chat bubble above the speaker). Everything else here is a proposal for the team to confirm, change, or reject. Items marked **TBD** are open.

#### Goals

1. Simulate a conversation between a **perpetrator** (P) and a **victim** (V). V is the team's one Twilio number. P is simulated: it sends Twilio-format webhook requests to the gateway as if Twilio were delivering an SMS to V.
2. **Intercept** every message sent to V before it reaches the victim: classify it, then deliver it or block it.
3. Publish what happened as plain events, so any display can show it. The first display is a simple 3D scene built with React Three Fiber. Nothing in the pipeline depends on that scene.
4. When a scam is blocked, **tell the victim** with a short notice that links to a panel in the web app showing what was blocked, why, and which words gave it away.
5. Later, let real people text V from their own phones through the same pipeline, with no changes to the scene.

#### What "intercept" means here

Twilio delivers every SMS sent to V straight to **our** webhook. No phone sits behind V. The victim's "phone" is a **virtual inbox** that the gateway owns. So the gateway acts as the victim's carrier:

- **Deliver:** the message is added to the victim's inbox and published as delivered.
- **Block:** the message is kept in a quarantine log, never reaches the inbox, and is published as blocked.
- **Flag (optional, TBD):** delivered with a warning, for borderline scores.

Twilio cannot stop a message reaching our own number, and it doesn't need to. Interception happens in our code, between Twilio's webhook and the victim's inbox. Blocking needs no outbound SMS, so trial-account and A2P 10DLC limits don't apply to it.

Forwarding delivered messages to a real handset (for example, a teammate's phone acting as the victim) is **later scope**. It would be outbound SMS, so it needs an upgraded account and A2P 10DLC or toll-free verification.

#### Components

```
 ┌──────────────┐                            ┌──────────┐
 │ Message bank │                            │  Twilio  │◀── SMS to V ── Real phones
 └──────┬───────┘                            │ (number V)│    (path check; later:
        ▼                                    └────┬─────┘     public demo)
 ┌──────────────────────┐  signed Twilio-format   │ inbound webhook (V)
 │ Perpetrator simulator│  POST, as if to V       │
 │ (bank / typed)       │ ────────────────────────┤
 └──────────────────────┘                         ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ Interception gateway                                          │
 │  1. verify X-Twilio-Signature                                 │
 │  2. dedupe on MessageSid (Twilio retries)                     │
 │  3. normalize → internal Message                              │
 │  4. Classifier port → HTTPS call to model on Vultr → Verdict  │
 │  5. Policy: Verdict → deliver | block | (flag)                │
 │  6. store in victim inbox or block log                        │
 │  7. if blocked: Notifier port → scam notice to the victim     │
 │  8. publish events (fire-and-forget)                          │
 │  9. return empty TwiML (no auto-reply to the sender)          │
 │  + read-only query API: GET /api/blocked, /api/blocked/:id    │
 └───────┬───────────────────────────────────┬──────────────────┘
         │ versioned events (JSON)            │ read-only HTTP (JSON)
         │ over WebSocket or SSE              │
     ┌───┴──────────────────────┬─────────────┼───────────┐
     ▼                          ▼             ▼           ▼
 Next.js web app (Vercel)                          Event log file   (any future
  ├─ /         3D scene (R3F)   ◀── events          (debug/replay)   consumer)
  └─ /blocked  blocked-scams panel ◀── query API (+ events for live updates)
```

| Component | Responsibility | Knows about | Must not know about |
|---|---|---|---|
| **Perpetrator simulator** | Picks messages from the message bank (or takes typed ones) and POSTs signed, Twilio-format inbound-SMS requests to the gateway webhook | Twilio webhook format, auth token for signing, message bank | Classifier, gateway internals, scene |
| **Message bank** | Labeled scam and legitimate example messages for the simulator, tests and demos | Its own file format | Everything else |
| **Interception gateway** | Webhook, signature check, dedupe, normalize, classify, policy, store, publish | Twilio webhook format, classifier port, event contract | The scene, or any renderer |
| **Classifier service** | Separate Python inference service, likely hosted on **Vultr** (under consideration). `POST` text → `{ label, score, category, model, highlights }`. TF-IDF + LR or MiniLM, still TBD. The gateway reaches it only through its classifier port. | Model files | Twilio, events, web app |
| **Notifier** (inside the gateway, behind a port) | Sends the scam notice when a message is blocked: always to the virtual victim inbox, and optionally as a real SMS to a protected handset (TBD) | Notice template, web app base URL, Twilio API (SMS adapter only) | Classifier internals, web app code |
| **Event publisher** | Broadcasts contract events to subscribers. Drops slow or broken subscribers instead of blocking. | Event contract | Who the subscribers are |
| **Next.js web app** (`/` scene) | Renders events as blobs and chat bubbles | Event contract only | Twilio, classifier, gateway code, phone numbers |
| **Next.js web app** (`/blocked` panel) | Lists blocked messages with reason, category and highlighted keywords | Query API contract, event contract | Twilio, classifier, gateway code, phone numbers |

#### Decoupling rules

1. **The contract is the only shared thing.** The gateway and the web app share a versioned contract: the event schema and the read-only query API schema (schema files, not shared code). TypeScript types generated from those schemas are fine, since they're the contract, not implementation. The web app never imports gateway code, and the gateway never imports web app code.
2. **Read-only flow.** Events go from the gateway to consumers. The panel may also **read** from the gateway's query API. Nothing in the web app writes to the gateway or calls Twilio or the classifier.
3. **The pipeline doesn't care about displays.** Interception runs, decides and stores the same way with zero, one or many consumers connected. Publishing is fire-and-forget. A crashed or slow scene can never delay or change a block decision, or the webhook response to Twilio.
4. **Each side runs on its own.**
   - The gateway can be tested with no scene, using recorded webhook payloads and a fake classifier.
   - The web app can be built and demoed with no backend, using a **mock event source** that replays a JSON file of contract events, and mock query responses for the panel. The event-source URL is configuration, so switching from the mock to the live stream needs no code change.
5. **Separate deployables.** Separate directories, dependencies and start commands. Proposed layout (TBD): `services/gateway/` (TypeScript), `services/perpetrator-sim/` (TypeScript), `services/classifier/` (Python), `apps/web/` (Next.js: scene and panel), `data/message_bank/`, `contracts/events.v1.schema.json`, `contracts/query-api.v1.schema.json`, `contracts/fixtures/` (sample events and responses for both sides).
6. **Ports and adapters inside the gateway.** Twilio, the classifier, storage, the notifier and the publisher each sit behind a small interface. Tests and local development can swap in fakes, for example a keyword classifier until the model is ready.
7. **Contract changes are versioned.** Adding optional fields is fine within v1. Renaming, removing or changing the meaning of a field needs a new version. Consumers ignore fields and event types they don't know.

#### Event contract v1 (proposed)

Transport: WebSocket (or Server-Sent Events) at `/events`. TBD which one; both work for a one-way stream. Each frame is one JSON event.

Event types:

| Type | When |
|---|---|
| `message.received` | The webhook accepted a new inbound message (after dedupe) |
| `message.classified` | The classifier returned a verdict |
| `message.delivered` | Policy delivered it to the victim's inbox |
| `message.blocked` | Policy blocked it (quarantined) |
| `victim.notified` | The scam notice was sent for a blocked message (channel: `inbox` or `sms`) |
| `participant.joined` | A new sender appeared (useful for the public demo: spawn a new blob) |

Example:

```json
{
  "schema": "t-gate.events",
  "version": 1,
  "id": "evt_01J...",
  "type": "message.blocked",
  "occurredAt": "2026-11-07T21:14:03.120Z",
  "conversationId": "conv_8f2c",
  "message": {
    "id": "msg_51a0",
    "channel": "sms",
    "from": { "participantId": "p_perp", "role": "perpetrator", "display": "***-***-4821" },
    "to":   { "participantId": "p_victim", "role": "victim", "display": "Victim" },
    "body": "Your bank account is locked. Reply with your PIN to restore access."
  },
  "verdict": {
    "label": "scam", "score": 0.97, "category": "Imposter & Phishing", "model": "minilm-lr-category@0.1",
    "highlights": [
      { "start": 5, "end": 9, "text": "bank", "weight": 0.41 },
      { "start": 18, "end": 24, "text": "locked", "weight": 0.37 },
      { "start": 50, "end": 53, "text": "PIN", "weight": 0.88 }
    ]
  },
  "action": "blocked"
}
```

Contract rules:

- **No raw phone numbers, Twilio SIDs or credentials in events.** Use stable opaque `participantId`s and masked `display` strings. The gateway alone maps real numbers to participants.
- `role` is `perpetrator`, `victim` or `public` (public demo senders).
- `verdict.category` says **why** a message was blocked (see [Blocked-message tracking](#blocked-message-tracking)). It's required on `message.blocked` once a category scheme is chosen, and optional elsewhere. The category scheme is TBD.
- `message.body` is shown on screen, so the public demo needs moderation before body text reaches events (TBD).
- `verdict.highlights` is optional. It holds character spans in `message.body` and how strongly each one pushed toward "scam". See [Keyword highlighting](#keyword-highlighting).
- Ids are unique and events can arrive more than once, so consumers dedupe on `id`.

#### Gateway behavior details

- **Respond to Twilio fast** with an empty `<Response></Response>`. Twilio times out after about 15 seconds and retries. Classification is a network call to the Vultr service, so it needs a strict timeout (for example, 2–3 seconds; TBD). If it's routinely slow, acknowledge Twilio first and classify asynchronously.
- **No automatic reply to the sender.** Replying to a scammer confirms the number is live, and replies are outbound SMS anyway.
- **Idempotency:** dedupe on `MessageSid`, because Twilio retries webhooks.
- **Signature check:** reject requests without a valid `X-Twilio-Signature` (can be relaxed in local tests with recorded fixtures). The perpetrator simulator signs its requests the same way Twilio does, so the check stays on for simulated traffic too.
- **Simulated and real messages take the same path.** The gateway has no special branch for simulated traffic. Logs can tell them apart by sender (the simulator uses fictional numbers) or by a `MessageSid` prefix, if useful.
- **Loop protection:** if any automated replies are added later (victim bot, auto-responses), cap turns per conversation and never auto-reply to automated senders.
- **Fail-safe when the classifier is down: TBD.** The options are to deliver with an "unverified" flag (fail open) or hold in quarantine (fail closed). This is a product decision, so ask the team.
- **Thresholds: TBD.** For example, block when score ≥ X, flag when between Y and X. Depends on the classifier's evaluation.
- **Secrets:** Twilio account SID, auth token and the victim number live in `.env`. Commit only `.env.example`.
- **Storage:** in-memory or SQLite is enough for the MVP (TBD). It holds the inbox, the block log (quarantine) and the number → participant map.

#### Classifier service on Vultr

**Agreed (Tuan, 2026-11-07):** MiniLM, trained on a [Vultr](https://www.vultr.com/) Cloud GPU and served from Vultr Cloud Compute. Implementation: [`classifier/`](classifier/README.md).

- **Training:** embed with MiniLM and fit a logistic-regression head on a Vultr Cloud GPU instance (destroyed after each run; fine-tuning only if needed), using [`data/scam_categories_100k_full.csv`](#2026-11-07-training-data-is-scam_categories_100k_fullcsv). Evaluate only on the real `val`/`test` splits. Model artifacts are stored outside git (location TBD).
- **Inference:** host the trained model as a small HTTP service on Vultr. Proposed contract (TBD):

  ```http
  POST /classify
  Authorization: Bearer <token>
  { "messageId": "msg_51a0", "text": "Your bank account is locked..." }

  200 OK
  {
    "label": "scam", "score": 0.97, "category": "Imposter & Phishing", "model": "minilm-lr-category@0.1",
    "highlights": [ { "start": 50, "end": 53, "text": "PIN", "weight": 0.88 } ]
  }
  ```

- **Flow:** victim number receives SMS → Twilio webhook → gateway → `POST /classify` on Vultr → verdict → gateway policy blocks (scam) or delivers (legitimate) → events published.
- **Decision stays in the gateway.** Vultr returns a verdict only. The block/deliver policy (thresholds, fail-safe) lives in the gateway, so changing a threshold doesn't require redeploying the model.
- **Swappable:** the gateway reaches Vultr only through its classifier port. A local fake (keyword rules) works for development and tests, and a different host can replace Vultr without gateway changes.
- **Send only what's needed:** message text and an opaque message id. No phone numbers or Twilio identifiers go to the model service.
- **Security:** the service requires an auth token (stored in `.env`) and uses HTTPS.
- **Open (TBD):** instance sizes, region, container registry, HTTPS setup, and where model artifacts are stored.

#### Blocked-message tracking

Every blocked message gets a record of **why** it was blocked, so the team can report on it (for example, "12 blocked today: 5 impersonation, 4 prize/lottery, 3 delivery").

Proposed block record:

| Field | Meaning |
|---|---|
| `messageId`, `conversationId` | Opaque ids |
| `senderParticipantId`, `senderDisplay` | Opaque sender id and masked number |
| `body` | Message text (retention policy TBD) |
| `category` | Scam category, the reason it was blocked |
| `score` | Model confidence |
| `model` | Model name and version that made the call |
| `reason` | `model_verdict`, or `classifier_unavailable` if blocked by a fail-closed policy |
| `blockedAt` | Timestamp |

- **Categories:** the `data/` dataset already has 7 scam groups derived from the FTC Consumer Sentinel categories (`data/scam_categories.csv`), which fit naturally. Using them means choosing the multi-class label scheme, or adding a second category step after a binary scam check. Which one is still TBD.
- **Queries:** blocked counts by category and over time, and the most recent blocks. Who sees this (a dashboard, the scene, logs) is TBD.
- The `message.blocked` event carries `verdict.category`, so displays can show the reason, for example as a label on the red bubble.

#### Technology stack (TypeScript)

TypeScript is agreed (Tuan, 2026-11-07), since the web app is Next.js. One exception and one hosting caveat:

- **TypeScript (Node 20+):** the gateway, the perpetrator simulator, the Next.js web app and the generated contract types. Twilio's `twilio` npm package has first-class TypeScript support, including `validateRequest` for webhook signatures and `getExpectedTwilioSignature` for the simulator. One language across these lets the team share tooling (pnpm workspaces, ESLint, Vitest).
- **Exception, Python for the model:** training and inference (scikit-learn for TF-IDF + LR, or sentence-transformers for MiniLM) belong in Python, where those libraries live. The gateway only talks to it over HTTP, so the language difference doesn't leak.
- **Keep the gateway out of the Next.js app.** It's tempting to put the webhook in a Next.js route handler on Vercel. The recommendation is a **separate TypeScript service** built with Hono on an always-on host, such as a Vultr VM next to the model:
  - Vercel functions are short-lived and can't hold the WebSocket/SSE event stream.
  - Vercel has no persistent local disk, so storage would need a hosted database.
  - A web app deploy or frontend bug could break interception. That breaks the "a display failure never affects blocking" rule.
- **Alternative (if the team prefers everything on Vercel):** webhook as a Next.js route handler, plus a hosted database (for example, Postgres or Upstash Redis) and a hosted realtime service (for example, Ably or Pusher) for events. It works, but it adds two external services and ties interception to the web app's deploys.

#### Scam notice to the victim

When the gateway blocks a message, the Notifier sends the victim a short notice. Proposed text (one SMS segment, under 160 characters):

> T-Guard blocked a potential scam from \*\*\*-\*\*\*-4821 (Imposter & Phishing). View: https://&lt;web-app&gt;/blocked/b_7Kq2

- **Never include the scam's text or links in the notice.** The victim shouldn't be one tap away from the scammer's link. The notice names the category and links to our panel only.
- **Where the notice goes (TBD):** the victim number is ours, and no phone sits behind it. Options:
  1. **Virtual victim inbox (always):** the notice is added to the victim's inbox and published as `victim.notified`. The web app can show it in a phone-style view, and the scene can show it as a bubble from a "T-Guard" blob.
  2. **Real SMS to a protected handset (optional):** the gateway texts a configured phone (for example, a teammate's) from the victim number. This is outbound SMS. A trial account can send only to **verified** numbers, with a trial prefix, which is fine for a teammate's phone. An upgraded account needs A2P 10DLC or toll-free verification.
- **Real-product framing (Safe Signal):** in production, T-Guard would sit at the carrier. The notice would come from the carrier to the subscriber's own phone, and the link would open the subscriber's blocked-scams view.
- **Rate limit:** batch notices if many scams arrive at once (for example, "3 potential scams blocked"). Threshold TBD.
- **Link format:** `/blocked/<blockId>` with an unguessable id (for example, 128-bit random). The MVP has no login. The panel shows only masked numbers. Whether real accounts are needed is TBD.

#### Blocked-scams panel

A page in the Next.js web app, separate from the scene (`/blocked` lists them, `/blocked/[id]` opens one).

- **List:** every blocked message, newest first, with masked sender, time, **category as a colored badge**, score and a one-line preview. Filter by category. Show counts per category at the top (for example, "Imposter & Phishing: 5").
- **Detail (where the notice link lands):** the full message with **keywords highlighted**, the category and what it means (from `data/scam_categories.csv`), the score, the reason (`model_verdict` or `classifier_unavailable`) and the time.
- **Defang links and numbers in scam text.** URLs and phone numbers inside blocked messages are shown as plain, non-clickable text (for example, `hxxps://bit[.]ly/...`).
- **"Words to watch" (optional):** the top scam keywords for each category, from the model (see below), so the victim can learn the patterns.
- **Data source:** the gateway's read-only query API (`GET /api/blocked`, `GET /api/blocked/:id`), plus the event stream for live updates. With no gateway URL configured, it uses mock fixtures, like the scene.
- **Possible later use:** a "This wasn't a scam" button (a false-positive report). That would be a **write** to the gateway, so it needs an explicit contract change and an auth decision. Not in the proposal yet.

#### Keyword highlighting

Yes, this is possible. How easy it is depends on the classifier choice.

- **TF-IDF + logistic regression (straightforward):** the model is linear. Each term's contribution to a message's score is its TF-IDF value in that message times the model's coefficient for that term. The terms with the largest positive contributions are the keywords to highlight. For an 8-class model, use the coefficients of the predicted category.
  - **Per message:** the inference service returns the top contributing terms as character spans (`highlights`). To map terms back to spans, run the vectorizer's token pattern with `re.finditer` on the original text. Lowercasing doesn't move character offsets for ASCII text. Highlight both words of a matching bigram.
  - **Global "words to watch":** the largest coefficients for each category give the terms most associated with each scam type. This is a static list, computed once per model version.
- **MiniLM (harder):** embeddings don't map to words directly. Options: **occlusion** (remove each word, re-score, and highlight the words whose removal drops the score most; about one extra model call per word, fine for SMS-length text), or attribution methods such as SHAP or integrated gradients (heavier). A hybrid (MiniLM decides, a TF-IDF model supplies highlights) is possible, but the highlights might not match why MiniLM decided.
- **Explainability is a factor in the classifier decision.** TF-IDF + LR gives faithful, cheap highlights. That's a point in its favor, though the choice is still TBD.
- **Caveats to keep in mind:**
  - **The labels came partly from keyword rules** (`data/ftc_taxonomy.py`), so the model will tend to relearn those keywords. Highlights may mostly echo the rules rather than reveal new patterns.
  - **Highlights are associations, not proof.** "Bank" appears in real bank texts too. The panel should say something like "words often seen in scams", not "these words make it a scam".
  - Show only the top few terms (for example, up to 5) with a minimum weight, so messages aren't covered in highlights.
- **For messages that get through:** when a delivered message has notable scam-term weight but isn't blocked (a borderline or "flag" case), the victim view could show soft highlights too. That helps the victim judge for themselves when the model misses. Whether to do this, and the threshold, are TBD.

#### Perpetrator simulator

The perpetrator has no Twilio number. The simulator pretends to be Twilio delivering an SMS to V:

- **Request format:** `POST` to the gateway's webhook URL with the same form-encoded fields Twilio sends for an inbound SMS (`From`, `To` = V, `Body`, `MessageSid`, `AccountSid`, `NumMedia=0`, …). Exact field list: copy from a recorded real webhook once the number is set up.
- **Signature:** computes `X-Twilio-Signature` like Twilio does (HMAC-SHA1 over the full webhook URL plus the sorted POST parameters, keyed with the auth token, base64-encoded). Twilio's helper libraries include the validator, which can be used to check the simulator's output. Because the signing URL must match exactly, the simulator takes the webhook URL as configuration.
- **Sender numbers:** fictional numbers (for example, the reserved `+1-555-01xx` range), one per simulated scammer, so the scene can show several perpetrators.
- **`MessageSid`:** a unique id per message (for example, `SM` + 32 hex characters), so the gateway's dedupe works normally.
- **Modes (mix TBD):** scripted conversations (ordered messages with delays), random draws from the message bank (for example, "10 messages, 60% scam"), and interactive (a teammate types messages).
- **Dry run:** prints the requests instead of sending them.
- **No cost:** nothing goes through Twilio, so there are no message fees or registration requirements.
- **Real path check:** texting V from a real phone confirms the actual Twilio → gateway path. Do this at least once before the demo.
- Optional **victim driver** (TBD): V → P replies for a two-way conversation. Since P is simulated, replies would not be sent as SMS. They'd only be published as `message.delivered` events with `role: victim`, so the scene shows both sides talking.

#### Message bank

A file of labeled example messages the simulator sends. It makes demos repeatable and lets the team check that the gateway blocks scams and delivers legitimate messages.

- **Candidate sources (mix TBD):**
  - **Real messages from `data/`:** a subset of the `test` split (real, never used for training, so the demo isn't showing the model its own training data). Prefer `style == sms` rows: the Enron email rows are lowercased, have no punctuation and start with `subject`, which doesn't look like a text message. Pick rows across all scam categories plus ham.
  - **The test split is thin on SMS-style scams.** Counted 2026-11-07 from `scam_categories_100k_full.csv`, `split == test`, `style == sms`: ham 450; Internet/Telecom 117; Prizes 19; Imposter & Phishing 15; Shopping 3; Jobs/Investment 2; Health 1; Loans 0. So real SMS rows alone can't cover most categories. The options are to use email rows (rewritten to read like texts, or as-is), to generate messages, or both (TBD).
  - **Generated messages:** template-built or LLM-written messages for scam types the dataset covers poorly (for example, "Hi Grandma, it's me, I'm in trouble" family-emergency texts) and for scripted demo conversations. Generation method is TBD. Mark these rows as generated.
- **Proposed row fields (TBD):** `id`, `text`, `expected_label` (scam/legit), `category` (from `data/scam_categories.csv`), `source` (`dataset_test` or `generated`), and the source row id for dataset rows.
- **Expected labels are for checking, not deciding.** The gateway never sees `expected_label`. It's used afterwards to compare the model's verdict with the expected one.
- **Evaluation caution:** test-split rows in the bank are fine for demos, but don't tune block thresholds on them, or the reported test metrics stop being honest. Tune on `val`.
- **Location:** small enough to commit (for example, `data/message_bank/`). Format (JSONL, CSV or YAML) is TBD.

#### 3D scene (simple, React Three Fiber)

The scene is a **pure consumer** of the event stream. It's intentionally simple. It's built with React Three Fiber, with Motion for the DOM layer (see the decision log):

- **Blob people:** low-poly spheres or capsules with simple faces (eyes). Each participant from the events gets a blob, colored by role: victim in the center, perpetrator nearby, public senders spawn at the edges when `participant.joined` arrives.
- **Idle motion:** blobs wander slowly and bob, with no physics.
- **Talking:** on a message event, the sender's blob turns toward the recipient and shows a **chat bubble** above its head with the message text, truncated to fit.
- **Delivered (legitimate):** a neutral or green bubble floats to the victim, and the victim reacts (for example, a small bounce).
- **Blocked (scam):** the bubble turns red with a 🚫 or "Blocked" stamp, stops before it reaches the victim and fades or pops. An optional shield flashes around the victim.
- **Blobs:** each participant is a small React component (`<Blob role=… />`): a sphere or capsule mesh with eyes, positioned and animated in `useFrame` with damping for smooth wandering, turning and bouncing.
- **Chat bubbles:** HTML rendered above each blob with drei's `<Html>` and animated with `motion/react` (pop in, float toward the victim, red flash and pop for blocked). Since bubbles are DOM, Motion handles them directly, and the text stays sharp and easy to style.
- **State:** a small client store (for example, Zustand; TBD) holds participants and in-flight messages. The event source writes to it, and scene components read from it. Scene components never talk to the event source directly.
- **Hosting (under consideration):** see [Scene hosting](#scene-hosting-nextjs-on-vercel-under-consideration).
- **Event source is configuration:** `?source=mock` replays `contracts/fixtures/*.json`. `?source=ws://host/events` connects live. Reconnects with backoff, and keeps running (blobs idle) when disconnected.
- **No business logic in the scene.** It shows `action` from the event and never re-decides scam vs. legitimate.

#### Scene hosting: Next.js on Vercel (under consideration)

The scene would be a **Next.js** website, ready to deploy on **Vercel**.

- **Separate app:** the web app is its own Next.js project (for example, `apps/web/`) with its own `package.json`. It hosts the scene (`/`) and the blocked-scams panel (`/blocked`) as separate routes. It depends only on the contract schemas and fixtures.
- **Client-side rendering:** R3F's `<Canvas>` runs in the browser, so the scene is a client component (`"use client"`), loaded with `next/dynamic` and `ssr: false`. Use React Three Fiber v9 or later, which supports React 19 (current Next.js). Motion's `motion/react` works in client components.
- **The event stream is not hosted on Vercel.** Vercel functions are short-lived and can't hold a WebSocket server. The browser connects directly to the gateway's stream, which runs elsewhere (for example, on Vultr or another always-on host). This matches the decoupling rules: the scene only knows a URL.
- **Configuration:** the stream URL comes from an environment variable such as `NEXT_PUBLIC_EVENTS_URL`. If it's unset, the scene uses the mock fixture source, so preview deploys work with no backend.
- **No secrets in the web app.** Anything prefixed `NEXT_PUBLIC_` ships to the browser, so the web app gets only the public stream and query API URLs (`NEXT_PUBLIC_EVENTS_URL`, `NEXT_PUBLIC_API_URL`). Twilio and Vultr credentials stay in the gateway.
- **CORS and origins:** the gateway's stream and query API must allow the Vercel domain (production and preview URLs). Public read-only access vs. a viewer token is TBD.
- **Vercel deploy:** set the project root to the scene directory. Vercel builds and serves it like any Next.js app.

#### Phasing

1. **MVP:** the simulated perpetrator sends message-bank messages to V's webhook, the gateway intercepts and classifies, events are published, and the scene shows blocked vs. delivered. Blocked messages produce a scam notice with a link to the blocked-scams panel, which shows the category and highlighted keywords. A real phone texts V at least once to check the real path.
2. **Later (public demo):** real phones text V. Events carry `role: public` and the scene spawns new blobs. Needs moderation, rate limits, masking and cost controls (all TBD).
3. **Later:** optional forwarding of delivered messages to a real handset (needs outbound SMS registration).

#### Open questions (TBD)

- Separate gateway service vs. Next.js route handlers on Vercel.
- Where the scam notice goes: virtual inbox only, or also a real SMS to a protected handset. Notice batching threshold.
- Whether the panel needs real login, or unguessable links are enough for the MVP.
- Highlights use occlusion (MiniLM agreed). Whether delivered borderline messages get soft highlights.
- Training-row filtering in `scam_categories_100k_full.csv` (by `label_confidence`, template-synthetic rows).
- Message bank: how many rows, the dataset/generated mix, the generation method and the file format.
- WebSocket vs. SSE for the event stream. Where the gateway is hosted for the demo (tunnel vs. deployed).
- Fail-open vs. fail-closed when the classifier is unavailable. Block and flag thresholds.
- Whether the victim side replies (victim driver), and whether those replies are classified.
- Storage choice and retention of message bodies.
- Moderation and privacy rules before message bodies are shown on a public screen.
- Scene state store (for example, Zustand) and whether `maath` damping or `@react-spring/three` animates the blobs.
- Vultr: instance sizes, region, registry, HTTPS, and where model artifacts live (training and inference both run on Vultr, agreed).
- Category scheme for block reasons (multi-class model vs. binary check plus a category step), and who sees block reports.
- Where the gateway and its event stream are hosted, since Vercel can't host the WebSocket stream.

