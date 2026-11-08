# Voice guard worker

This LiveKit Agents worker is the caller-only receiver for the voice scam guard. It filters for SIP participant audio, streams it to AssemblyAI Universal-Streaming through LiveKit Inference, and keeps finalized transcript text in memory. After the caller hangs up, it sends the transcript to the **T-Guard gateway on the VM** the same way the perpetrator simulator and the web Simulate panel do: a Photon (Spectrum) inbound-iMessage webhook, signed with `X-Spectrum-Signature`, POSTed to `/webhooks/photon`. The gateway then runs its normal pipeline (classifier, review band, money rule, block or deliver), stores the result, and the web UI shows it on `/messages` through `GET /api/messages`. The worker never calls the classifier or Photon directly.

It publishes a zero-amplitude audio track to complete LiveKit's SIP answer handshake; it does not send speech or caller audio back to the caller. It never persists audio or logs transcript text or caller numbers.

## What the gateway receives

One signed `messages` event per call, the same shape `apps/web/lib/server/simulate.ts` builds:

- `message.id`: `voice-<uuid>` (a random per-call id; the gateway dedupes on it).
- `message.sender.id`: the caller's number from the SIP participant's `sip.phoneNumber` attribute, or `+10000000000` if LiveKit didn't provide one. The gateway keeps raw handles in its own SQLite DB only and shows them masked (`***-***-1234`).
- `space.id`: `voice;-;<caller>`, so a call doesn't merge into that number's iMessage chat. `space.phone` is `VOICE_GUARD_VICTIM_LINE` (default `+15555550100`).
- `message.content`: `{ type: "text", text: <transcript> }`.

The gateway acks with `200 ok` before it classifies, so the worker only logs `transcript_sent_to_gateway`; the verdict appears in the gateway's logs and in `GET /api/messages` a moment later. In the UI a call currently looks like a text message from the caller's masked number.

## Local setup

1. Copy `.env.example` to `.env` and set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` from LiveKit Cloud.
2. Leave `VOICE_GUARD_CAPTURE_ENABLED=false` until a consented test call is authorized. This default keeps the worker from connecting to the room or subscribing to call audio.
3. Set `GATEWAY_WEBHOOK_URL` to the gateway's webhook (`https://<gateway-host>/webhooks/photon`, or `http://localhost:8787/webhooks/photon` for a local gateway) and `GATEWAY_WEBHOOK_SECRET` to the gateway's `PHOTON_WEBHOOK_SECRET`. Leave both empty to transcribe only.
4. Install dependencies with `npm install`.
5. Start the worker with `npm run dev`.

## Local end-to-end demo

1. Start the gateway (`services/gateway`, see its README) with a `PHOTON_WEBHOOK_SECRET` and a classifier, and the web app (`apps/web`) with `NEXT_PUBLIC_API_URL=http://localhost:8787`.
2. In the worker's `.env`:

   ```dotenv
   VOICE_GUARD_CAPTURE_ENABLED=true
   GATEWAY_WEBHOOK_URL=http://localhost:8787/webhooks/photon
   GATEWAY_WEBHOOK_SECRET=<the gateway's PHOTON_WEBHOOK_SECRET>
   ```

   Start it with `npm run dev`.
3. Place a consented call. After hangup, the transcript shows up on `/messages` as delivered or blocked.

The `T-Gate Voice` inbound SIP dispatch rule targets agent name `voice-guard`. Set `VOICE_GUARD_CAPTURE_ENABLED=true` only for an authorized, consented call.

## Live call: victim on a real phone, live scoring, whisper warning

Optional, off unless configured. Design: `docs/features/voice-scam-guard.md`, "Live call design".

1. The scammer calls the Photon voice number; the call lands in a LiveKit room and this worker joins and answers (silence track, as before).
2. If `VOICE_SCORE_URL`/`VOICE_SCORE_TOKEN` are set, the worker publishes a silent **whisper** track and unsubscribes the caller from it server-side (`RoomServiceClient.updateSubscriptions`). The warning audio is synthesized ahead of time with LiveKit Inference TTS. If isolating the caller fails, there is no whisper at all (`whisper_unavailable`), so the scammer can never hear it.
3. If `VOICE_GUARD_VICTIM_PHONE`/`LIVEKIT_SIP_OUTBOUND_TRUNK_ID` are set, the worker dials the victim's phone into the same room (`SipClient.createSipParticipant`, identity `tguard-victim`). LiveKit SIP participants hear all audio in the room, so the two talk normally.
4. Only the caller's track is transcribed. After each finalized utterance, at most every `VOICE_SCORE_INTERVAL_MS`, the caller's transcript so far goes to the gateway's `POST /voice/score`. The gateway returns `warn` or `none` and stores nothing.
5. On the first `warn`, the worker speaks the warning into the whisper track, so only the victim hears it (it waits for the victim to pick up if needed). One warning per call.
6. When either side hangs up, the worker hangs up the other. The full transcript then goes to `/webhooks/photon` as before and shows on `/messages`.

Log events to trace a call: `whisper_ready`, `victim_dialing`, `victim_call_status`, `live_scored`, `live_warning`, `live_warning_spoken`, `caller_hung_up` / `victim_hung_up`, `transcript_sent_to_gateway`. Failures: `whisper_unavailable`, `victim_dial_failed`, `live_score_failed`, `live_warning_not_spoken`, `live_warning_failed`, `hangup_other_failed`.

Unverified until a real call: whether Photon (or the chosen SIP provider) accepts the outbound leg, whether `updateSubscriptions` keeps a SIP caller off the whisper track, the TTS model/voice defaults, and end-to-end latency.

## Container and LiveKit Cloud deployment

The Dockerfile compiles TypeScript into `dist/` and runs `node dist/agent.js start` as an unprivileged user. `.dockerignore` excludes local `.env` files and build artifacts. Build locally with `npm run build`; the container image installs production dependencies only.

The selected host is LiveKit Cloud. The production `voice-guard` agent is deployed in `us-east` with `VOICE_GUARD_CAPTURE_ENABLED=true`; LiveKit injects `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`. To send transcripts to the VM after deploying this version, set the Cloud secrets `GATEWAY_WEBHOOK_URL=https://<gateway-host>/webhooks/photon` and `GATEWAY_WEBHOOK_SECRET` (the gateway's `PHOTON_WEBHOOK_SECRET`). The old `CLASSIFIER_*` and `VOICE_GUARD_RESULTS_*` variables are no longer read.

The current Build plan includes 1,000 agent session minutes, 1,000 third-party SIP minutes, and $2.50 of LiveKit Inference allowance. Production workers can cold-start after idle, adding up to 10–20 seconds before joining a call. Production dispatch has not been verified with a post-deployment call.

## Data handling

- Audio frames are streamed directly from the SIP track into LiveKit Inference and are not written to disk or object storage.
- Only finalized transcript text is buffered in process memory. Interim transcript events are ignored.
- The final transcript and caller number go over HTTPS to the gateway only. The gateway stores them in its SQLite DB like any iMessage (raw handle internal, masked in the API) and sends only the text and an opaque id to the classifier. Transcript retention follows the gateway's message storage (Clear chats deletes them); a call-specific retention period is still TBD.
- LiveKit documents Inference as zero-data-retention by default, including audio and model outputs.
- Logs contain only opaque IDs and event names, never caller numbers or transcript text.

## Current limits

- English transcription only, matching Universal-Streaming's documented language support.
- The classifier is trained on text messages. Call-level accuracy, transcript windowing, and thresholds are not validated.
- Calls appear in the UI as text messages; there is no call badge or separate message kind yet.
- The worker sends once and does not retry if the gateway is unreachable; the transcript is then dropped.
