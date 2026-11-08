# Feature: Voice scam guard

- **Slug:** `voice-scam-guard` (used in branch names: `feat/voice-scam-guard-<short-task>`)
- **Phase:** Later / stretch
- **Status:** In review (master plan)
- **Owner:** TBD

## Goal

Route calls to a Photon voice number through a SIP media application, transcribe the caller's speech, classify transcript text with T-Gate's classifier, and show a potential-scam warning in the Vercel app. The first proof scores after the tester hangs up; the main follow-up scores during the call. This feature is separate from the current iMessage MVP. See the [master plan](../../.plans/voice-scam-guard-spec.md), [AGENTS.md voice scope](../../AGENTS.md#deferred-or-stretch), and [CHANGELOG.md decision log](../../CHANGELOG.md#2026-11-08-voice-scam-guard-feasibility-and-staged-plan-proposal).

## Out of scope

- Changing the iMessage webhook to carry audio or trying to capture audio from a normal message webhook.
- Persisting raw audio in the first prototype.
- Automatically blocking, ending, or responding to calls.
- Treating the current SMS-trained classifier as validated for voice calls.
- Public or non-consented calls before privacy, disclosure, and applicable consent requirements are resolved.

## Open questions

- Whether the voice number is assigned to the team's Photon 2.0/Beta project, plus its number eligibility and Voice profile.
- STT provider and model are selected: AssemblyAI Universal-Streaming through LiveKit Inference. Worker host/deployment target, latency target, and transcript retention duration remain TBD.
- Victim endpoint for the two-party stage: handset bridge or browser participant.
- Transcript retention duration and UI access control.
- Call transcript windowing/aggregation, classifier thresholds, and acceptance metrics.
- Live warning transport, placement, and latency target.
- Failure handling and applicable consent/disclosure review.

## Tasks

Tasks are grouped into ordered stages. Stage 0 gates the prototype. Stage 1 tasks may run in parallel after the Photon/line checks, except where a dependency is listed.

### Stage 0: route and account feasibility

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 0.1 | Confirm Photon product version, voice-capable line type, Voice profile, and inbound SIP route | — | — | In progress | `feat/voice-scam-detection` | Codex | [#36](https://github.com/tuann72/HackUTD/pull/36) |
| 0.2 | Confirm Photon and LiveKit/STT call costs and define a consented setup for any verification call | 0.1 | — | In progress | `feat/voice-scam-detection` | Codex | [#36](https://github.com/tuann72/HackUTD/pull/36) |

### Stage 1: caller-only capture, after-call classification

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 1.1 | Route a test call from the Photon voice number into a LiveKit room; verify caller audio | 0.1, 0.2 | 1.3 | In review | `feat/voice-scam-guard-stt` | Codex | [#51](https://github.com/tuann72/HackUTD/pull/51) |
| 1.2 | Stream caller audio to STT; buffer transcript only and discard audio; finalize on hangup | 1.1 | — | In review | `feat/voice-scam-guard-stt` | Codex | [#51](https://github.com/tuann72/HackUTD/pull/51) |
| 1.3 | Evaluate short call transcripts with the existing text classifier and define call-result fields | 0.1 | 1.1 | In progress | `feat/voice-guard-call-results` | Codex (agent) | [#63](https://github.com/tuann72/HackUTD/pull/63) |
| 1.4 | Add versioned read-only call-result contract/API and Vercel result display | 1.2, 1.3 | — | In progress | `feat/voice-guard-call-results` | Codex (agent) | [#63](https://github.com/tuann72/HackUTD/pull/63) |
| 1.5 | Verify caller-only end-to-end call: hang up, then see transcript and verdict in the web app | 1.1, 1.2, 1.3, 1.4 | — | Not started | — | TBD | — |
| 1.6 | Deploy the caller-only worker to LiveKit Cloud and verify production dispatch | 1.1, 1.2 | 1.3, 1.4 | In progress | `feat/voice-scam-guard-stt` | Codex | [#51](https://github.com/tuann72/HackUTD/pull/51) |

### Stage 2: connect a human victim

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 2.1 | Choose and connect the victim endpoint (handset via SIP or browser participant) | 1.5 | — | Not started | — | TBD | — |
| 2.2 | Bridge both sides while the guard scores only the caller's participant track | 2.1 | — | Not started | — | TBD | — |
| 2.3 | Verify two-way call quality and caller-only transcript attribution with after-call scoring | 2.2 | — | Not started | — | TBD | — |

### Stage 3: live classification and warning

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 3.1 | Define transcript windows, utterance finalization, score aggregation, and warning thresholds | 2.3 | — | Not started | — | TBD | — |
| 3.2 | Score finalized transcript segments while the bridged call is active | 3.1 | 3.3 | Not started | — | TBD | — |
| 3.3 | Deliver versioned live call status/warnings to the Vercel app | 1.4, 3.1 | 3.2 | Not started | — | TBD | — |
| 3.4 | Measure warning latency, missed scam cues, and false warnings during bridged scripted calls | 3.2, 3.3 | — | Not started | — | TBD | — |

## Task details

### 0.1 Confirm Photon product and route

- **What:** Confirm the voice number is assigned to the team's Photon 2.0/Beta project, verify that its number type is voice-capable, and confirm its Voice profile and inbound SIP destination. The shared-pool iMessage line is not assumed to support voice.
- **Files:** `docs/SETUP.md` only after the team confirms account details; never record credentials.
- **Done when:** The voice number's project assignment, number type, Voice profile, route, and whether an inbound test call reaches SIP are recorded without secrets.

### 1.1-1.2 Receive and transcribe a consented test call

- **What:** Use the Photon voice SIP path into LiveKit. Subscribe to the caller's audio track and run STT. Hold transcript text only for scoring at hangup; do not write audio to disk or object storage.
- **Files:** Future voice service package and its deployment/configuration docs; exact package and host TBD.
- **Done when:** A consented caller can speak, hang up, and produce a final transcript; raw audio is absent from persistent storage.

### 1.3 Reuse and evaluate the classifier

- **What:** Send transcript text and an opaque call/segment ID to the existing `POST /classify`. Measure behavior on short scam-style and legitimate call scripts. The existing classifier is SMS/text-message trained, and MiniLM input truncates at 256 tokens, so long calls require a separately evaluated windowing and aggregation design.
- **Files:** `services/voice-guard/`, `contracts/`, and the Vercel result API; model and dataset changes only after evaluation.
- **Done when:** A small held-out test set, score behavior, and limitations are documented; no call-level accuracy claim is made from SMS metrics.

### 1.4 Show call results in the Vercel app

- **What:** Define a versioned call-result schema and read-only API. Render transcript, verdict, score, and model information; keep classification and call logic server-side.
- **Files:** `contracts/`, `apps/web/`, and `services/voice-guard/`.
- **Done when:** The Vercel page reads a real or fixture call result without calling the classifier or changing the verdict.

Implementation details for tasks 1.3–1.4:

- The worker posts `{ messageId, text }` to the existing classifier, where `messageId` is a random opaque UUID. After classification, it sends the v1 call-result payload to `VOICE_GUARD_RESULTS_URL` with `VOICE_GUARD_RESULTS_INGEST_TOKEN`.
- Vercel `POST /api/voice/calls` stores only validated result payloads in the separate Atlas `voiceCallResults` collection. `GET /api/voice/calls` returns the v1 contract and requires `VOICE_GUARD_RESULTS_VIEW_TOKEN`; the `/voice` page accepts this token in memory only and polls the read API.
- On Vercel, result storage stays disabled unless `MONGODB_URI`, `VOICE_GUARD_RESULTS_INGEST_TOKEN`, `VOICE_GUARD_RESULTS_VIEW_TOKEN`, and an explicit positive `VOICE_GUARD_RESULTS_TTL_SECONDS` are configured. The write route derives `expiresAt` from call completion, applies an Atlas TTL index, and filters expired rows on every read. No default retention duration is selected.
- The view-token mechanism is a protective gate for this prototype, not a resolved identity or access policy. Who should hold it remains TBD. Local development without Atlas uses process memory and loses results on restart.
- The classifier call and result-upload failures are logged by opaque call ID only; transcript text is not logged, and publication failure does not terminate the call.

### 2.1-2.3 Bridge and verify the caller–victim call

- **What:** Connect a human victim on a second call leg while preserving the caller's participant track for analysis. Keep classification after hangup until two-way call behavior and caller-only attribution work.
- **Files:** Voice service and deployment config; contract/API and `apps/web/` only if call-result metadata changes.
- **Done when:** Caller and victim can hear each other, the transcript includes caller speech only, and failure of STT/classification does not terminate the call.

### 3.1-3.4 Score and warn during an active call

- **What:** Prefer finalized utterances or stable transcript segments; suppress duplicate warnings; show a “potential scam” warning while leaving the call connected. Measure latency and false positives before selecting thresholds.
- **Files:** Voice service, call-result contract/API, and `apps/web/` warning UI.
- **Done when:** A controlled bridged call shows a warning before hangup and records latency and false-warning results.

## Progress notes

- **2026-11-08:** Master plan created after interview. User requested a caller-only test scored after hangup, then live warnings as the main follow-up. Keep transcript and verdict; do not retain audio. Victim endpoint, Photon version/line eligibility, STT choice, transcript retention duration, and warning thresholds remain TBD.
- **2026-11-08:** Read-only account checks confirmed the team's Photon project is Beta and has one active `voip_line` with `pstn_voice` capability. Its default SIP profile covers that line, but inbound routing is disabled. The additional `T-Gate` profile has no assigned lines and inbound routing is also disabled. On LiveKit Cloud, the `T-Gate` project has one inbound SIP trunk and no dispatch rules; the project's SIP URI is available in its settings. The project is on the Build plan with no usage and a $0 current invoice. LiveKit's [published Build allowance](https://docs.livekit.io/deploy/admin/quotas-and-limits/) includes 1,000 third-party SIP minutes. Photon’s [current billing catalog](https://photon.codes/docs/beta/api-reference/project-billing/list-billing-plans) lists Messaging Free voice rates of $0.013/min for US/Canada, $0.065/min in-network, and $0.34/min out-of-network; which rate applies depends on Photon’s call classification. The additional profile `T-Gate` has no lines assigned. No Photon inbound write control is exposed in the current dashboard view for the assigned default profile, and the connected Photon tools expose no inbound configuration operation. The LiveKit dispatch rule `T-Gate Voice` has now been created for the existing inbound trunk, with one individual room per call and no agent. Photon inbound routing remains off, no plan was changed, and no test call was placed. The STT provider and its cost remain TBD.
- **2026-11-08 (owner setup):** The project owner saved Photon inbound routing on the assigned default SIP profile, targeting the LiveKit project SIP URI over TLS. Photon now reports an inbound destination and the `tgate-photon` SIP username; the password is stored write-only. The owner also configured the matching username/password on LiveKit's inbound trunk. The `T-Gate Voice` individual dispatch rule references that trunk and creates one room per call with no agent, following the [Photon LiveKit setup guide](https://photon.codes/docs/beta/cookbooks/voice/livekit). No test call was placed, so SIP connectivity is unverified. Calls currently have no LiveKit app or agent to process their audio. STT provider, transcript handling, and STT cost remain TBD.
- **2026-11-08 (first inbound call):** The caller reached LiveKit through the configured inbound trunk and dispatch rule. LiveKit created a `tgate-voice-` room and recorded the SIP participant as joining and active; its SIP call status stayed `ringing`. The caller then canceled, and LiveKit recorded SIP response `487` (`Request Terminated`). Photon marked the call canceled. This confirms delivery to the LiveKit room, but not that the call was answered or that usable audio reached an app. The dispatch rule has no agent, so adding a receiver is the next implementation step. No transcript or classifier result was produced.
- **2026-11-08 (STT decision and implementation start):** The user selected AssemblyAI Universal-Streaming through LiveKit Inference for Stage 1. LiveKit's current pricing lists the model at `$0.0025/min`; its docs say Inference uses LiveKit credentials and is zero-data-retention by default, including audio passed to the underlying STT provider. The TypeScript worker will subscribe to the SIP caller's audio track, keep final transcript text in memory only, and classify after hangup. Tasks 1.1–1.2 are in progress on `feat/voice-scam-guard-stt`. No test call or paid usage test is authorized in this task. Worker deployment, consent/disclosure, transcript retention, and call-result storage remain open.
- **2026-11-08 (local call verification and deployment target):** the `T-Gate Voice` dispatch rule was updated to target `voice-guard`. To complete the SIP answer, the worker publishes a zero-amplitude audio track; it does not speak or send caller audio back. A consented call showed `ringing` → `active` → `hangup`; STT returned non-empty speech and the transcript was discarded after the call. A one-call local debug log was enabled at the user's request, displayed the speech text, and was removed before restarting the worker. The classifier was not configured, so no verdict was produced. The user selected LiveKit Cloud Build; `Dockerfile`, `.dockerignore`, build config, and deployment notes are prepared. Tasks 1.1–1.2 are in review, and task 1.6 is in progress on `feat/voice-scam-guard-stt`.
- **2026-11-08 (classifier and Vercel call results):** tasks 1.3–1.4 are under review on `feat/voice-guard-call-results` (draft PR #63, stacked on #51). The worker now publishes the transcript and classifier fields to Vercel after a successful classification, using an opaque UUID; Vercel exposes a versioned read API and a protected `/voice` display. The result route uses a separate Atlas collection with expiry anchored to completion time. On Vercel, it fails closed unless the owner configures Atlas, separate ingest/view tokens, and `VOICE_GUARD_RESULTS_TTL_SECONDS`; no retention duration or viewer list is selected by code. The UI holds the view token in memory only. No test call, classifier evaluation, or paid usage check was run.
- **2026-11-08 (classifier/result implementation):** tasks 1.3–1.4 are in progress on `feat/voice-guard-call-results`, stacked on the worker branch. The existing classifier accepts caller transcript text with an opaque ID and returns label, score, category, model, and highlights. Transcript retention duration and who may view Vercel results remain TBD; production storage/display must require explicit configuration rather than silently retaining transcripts or exposing them publicly.
