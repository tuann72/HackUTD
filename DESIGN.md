# T-Gate Design

The detailed, evolving design document. `AGENTS.md` holds the current summary; this file holds the reasoning. Mark anything undecided as **TBD**.

## Decision log

Newest first. Each entry: date, decision, rationale, and what it replaces.

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

- **Stack (Tuan's lean, not final):** TypeScript for the gateway, the perpetrator simulator and the Next.js web app. The model training and inference service stays Python. See [Technology stack](#technology-stack-leaning-typescript).
- **Proposed:** when a scam is blocked, the victim gets a short notice ("T-Gate blocked a potential scam… View: <link>"). The link opens a **blocked-scams panel** in the Next.js app that lists every blocked message, why it was blocked and its category. The panel **highlights the keywords** that pushed the model toward "scam", so the victim learns to spot them in messages that get through.
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
- **Details:** see [Classifier service on Vultr](#classifier-service-on-vultr-under-consideration), [Blocked-message tracking](#blocked-message-tracking) and [Scene hosting](#scene-hosting-nextjs-on-vercel-under-consideration).

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
    "label": "scam", "score": 0.97, "category": "Imposter & Phishing", "model": "tfidf-lr@0.1",
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

#### Classifier service on Vultr (under consideration)

The team is considering [Vultr](https://www.vultr.com/) for training the model and running it.

- **Training:** run training jobs (TF-IDF + LR, or MiniLM fine-tuning, which benefits more from a GPU) on Vultr compute, using [`data/scam_categories_100k_full.csv`](#2026-11-07-training-data-is-scam_categories_100k_fullcsv). Evaluate only on the real `val`/`test` splits. Model artifacts are stored outside git (location TBD).
- **Inference:** host the trained model as a small HTTP service on Vultr. Proposed contract (TBD):

  ```http
  POST /classify
  Authorization: Bearer <token>
  { "messageId": "msg_51a0", "text": "Your bank account is locked..." }

  200 OK
  {
    "label": "scam", "score": 0.97, "category": "Imposter & Phishing", "model": "tfidf-lr@0.1",
    "highlights": [ { "start": 50, "end": 53, "text": "PIN", "weight": 0.88 } ]
  }
  ```

- **Flow:** victim number receives SMS → Twilio webhook → gateway → `POST /classify` on Vultr → verdict → gateway policy blocks (scam) or delivers (legitimate) → events published.
- **Decision stays in the gateway.** Vultr returns a verdict only. The block/deliver policy (thresholds, fail-safe) lives in the gateway, so changing a threshold doesn't require redeploying the model.
- **Swappable:** the gateway reaches Vultr only through its classifier port. A local fake (keyword rules) works for development and tests, and a different host can replace Vultr without gateway changes.
- **Send only what's needed:** message text and an opaque message id. No phone numbers or Twilio identifiers go to the model service.
- **Security:** the service requires an auth token (stored in `.env`) and uses HTTPS.
- **Open (TBD):** which Vultr products (cloud compute, GPU, serverless inference), cost, region and latency, and whether training and inference both run there or only one.

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

#### Technology stack (leaning TypeScript)

Tuan's lean is TypeScript, since the web app is Next.js. That fits, with one exception and one hosting caveat.

- **TypeScript (Node 20+):** the gateway, the perpetrator simulator, the Next.js web app and the generated contract types. Twilio's `twilio` npm package has first-class TypeScript support, including `validateRequest` for webhook signatures and `getExpectedTwilioSignature` for the simulator. One language across these lets the team share tooling (pnpm workspaces, ESLint, Vitest).
- **Exception, Python for the model:** training and inference (scikit-learn for TF-IDF + LR, or sentence-transformers for MiniLM) belong in Python, where those libraries live. The gateway only talks to it over HTTP, so the language difference doesn't leak.
- **Keep the gateway out of the Next.js app.** It's tempting to put the webhook in a Next.js route handler on Vercel. The recommendation is a **separate TypeScript service** (for example, Hono or Fastify; TBD) on an always-on host, such as a Vultr VM next to the model:
  - Vercel functions are short-lived and can't hold the WebSocket/SSE event stream.
  - Vercel has no persistent local disk, so storage would need a hosted database.
  - A web app deploy or frontend bug could break interception. That breaks the "a display failure never affects blocking" rule.
- **Alternative (if the team prefers everything on Vercel):** webhook as a Next.js route handler, plus a hosted database (for example, Postgres or Upstash Redis) and a hosted realtime service (for example, Ably or Pusher) for events. It works, but it adds two external services and ties interception to the web app's deploys.

#### Scam notice to the victim

When the gateway blocks a message, the Notifier sends the victim a short notice. Proposed text (one SMS segment, under 160 characters):

> T-Gate blocked a potential scam from \*\*\*-\*\*\*-4821 (Imposter & Phishing). View: https://&lt;web-app&gt;/blocked/b_7Kq2

- **Never include the scam's text or links in the notice.** The victim shouldn't be one tap away from the scammer's link. The notice names the category and links to our panel only.
- **Where the notice goes (TBD):** the victim number is ours, and no phone sits behind it. Options:
  1. **Virtual victim inbox (always):** the notice is added to the victim's inbox and published as `victim.notified`. The web app can show it in a phone-style view, and the scene can show it as a bubble from a "T-Gate" blob.
  2. **Real SMS to a protected handset (optional):** the gateway texts a configured phone (for example, a teammate's) from the victim number. This is outbound SMS. A trial account can send only to **verified** numbers, with a trial prefix, which is fine for a teammate's phone. An upgraded account needs A2P 10DLC or toll-free verification.
- **Real-product framing (Safe Signal):** in production, T-Gate would sit at the carrier. The notice would come from the carrier to the subscriber's own phone, and the link would open the subscriber's blocked-scams view.
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

- Confirm the TypeScript lean. Gateway framework (for example, Hono or Fastify), and separate service vs. Next.js route handlers on Vercel.
- Where the scam notice goes: virtual inbox only, or also a real SMS to a protected handset. Notice batching threshold.
- Whether the panel needs real login, or unguessable links are enough for the MVP.
- Highlight method if MiniLM is chosen (occlusion vs. attribution vs. hybrid). Whether delivered borderline messages get soft highlights.
- Training-row filtering in `scam_categories_100k_full.csv` (by `label_confidence`, template-synthetic rows).
- Message bank: how many rows, the dataset/generated mix, the generation method and the file format.
- WebSocket vs. SSE for the event stream. Where the gateway is hosted for the demo (tunnel vs. deployed).
- Fail-open vs. fail-closed when the classifier is unavailable. Block and flag thresholds.
- Whether the victim side replies (victim driver), and whether those replies are classified.
- Storage choice and retention of message bodies.
- Moderation and privacy rules before message bodies are shown on a public screen.
- Scene state store (for example, Zustand) and whether `maath` damping or `@react-spring/three` animates the blobs.
- Vultr: which products, cost, region and latency; whether it hosts training, inference or both; where model artifacts live.
- Category scheme for block reasons (multi-class model vs. binary check plus a category step), and who sees block reports.
- Where the gateway and its event stream are hosted, since Vercel can't host the WebSocket stream.

