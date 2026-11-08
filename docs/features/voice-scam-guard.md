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
- Speech-to-text provider, host, cost, and latency.
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
| 0.1 | Confirm Photon product version, voice-capable line type, Voice profile, and inbound SIP route | — | — | Not started | — | TBD | — |
| 0.2 | Confirm LiveKit/STT call costs and consented test setup before provisioning resources | 0.1 | — | Not started | — | TBD | — |

### Stage 1: caller-only capture, after-call classification

| # | Task | Depends on | Parallel with | Status | Branch | Owner | PR |
|---|---|---|---|---|---|---|---|
| 1.1 | Route a test call from the Photon voice number into a LiveKit room; verify caller audio | 0.1, 0.2 | 1.3 | Not started | — | TBD | — |
| 1.2 | Stream caller audio to STT; buffer transcript only and discard audio; finalize on hangup | 1.1 | — | Not started | — | TBD | — |
| 1.3 | Evaluate short call transcripts with the existing text classifier and define call-result fields | 0.1 | 1.1 | Not started | — | TBD | — |
| 1.4 | Add versioned read-only call-result contract/API and Vercel result display | 1.2, 1.3 | — | Not started | — | TBD | — |
| 1.5 | Verify caller-only end-to-end call: hang up, then see transcript and verdict in the web app | 1.1, 1.2, 1.3, 1.4 | — | Not started | — | TBD | — |

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
- **Files:** `classifier/` and future voice-service code; model and dataset changes only after evaluation.
- **Done when:** A small held-out test set, score behavior, and limitations are documented; no call-level accuracy claim is made from SMS metrics.

### 1.4 Show call results in the Vercel app

- **What:** Define a versioned call-result schema and read-only API. Render transcript, verdict, score, and model information; keep classification and call logic server-side.
- **Files:** `contracts/`, `apps/web/`, and the voice result service.
- **Done when:** The Vercel page reads a real or fixture call result without calling the classifier or changing the verdict.

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
