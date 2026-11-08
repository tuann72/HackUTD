# Voice guard worker

This LiveKit Agents worker is the caller-only receiver for the voice scam guard. It filters for SIP participant audio, streams it to AssemblyAI Universal-Streaming through LiveKit Inference, keeps finalized transcript text in memory, and submits that text to the existing classifier after the audio track ends when the classifier is configured. It publishes a zero-amplitude audio track to complete LiveKit's SIP answer handshake; it does not send speech or caller audio back to the caller. It does not persist audio/transcripts/results or log transcript text.

The transcript is sent to `POST {CLASSIFIER_URL}/classify` as `{ messageId, text }`, where `messageId` is a random UUID. No phone number, SIP identifier, or LiveKit room name is sent to the classifier. Call-result storage and the read-only UI API are later feature tasks.

## Local setup

1. Copy `.env.example` to `.env` and set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` from LiveKit Cloud.
2. Leave `VOICE_GUARD_CAPTURE_ENABLED=false` until a consented test call is authorized. This default keeps the worker from connecting to the room or subscribing to call audio.
3. Set `CLASSIFIER_URL` to the classifier service base URL and `CLASSIFIER_TOKEN` to its bearer token when the classifier is available. If unset, the worker transcribes in memory but skips classification.
4. Install dependencies with `npm install`.
5. Start the worker with `npm run dev`.

The `T-Gate Voice` inbound SIP dispatch rule targets agent name `voice-guard`. Set `VOICE_GUARD_CAPTURE_ENABLED=true` only for an authorized, consented call. The worker publishes silence so the caller is answered, then listens to caller audio; spoken response remains out of scope.

## Container and LiveKit Cloud deployment

The Dockerfile compiles TypeScript into `dist/` and runs `node dist/agent.js start` as an unprivileged user. `.dockerignore` excludes local `.env` files and build artifacts. Build locally with `npm run build`; the container image installs production dependencies only.

The selected host is LiveKit Cloud. Its agent deployment injects `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` automatically. Configure `VOICE_GUARD_CAPTURE_ENABLED=true` in the deployed agent's runtime secrets. Do not upload the local LiveKit credentials. `CLASSIFIER_URL` and `CLASSIFIER_TOKEN` are currently unset, so deployment can answer calls and transcribe them but will skip classification until those values are configured.

The current Build plan includes 1,000 agent session minutes, 1,000 third-party SIP minutes, and $2.50 of LiveKit Inference allowance. Production workers can cold-start after idle, adding up to 10–20 seconds before joining a call. Stop the local worker after the Cloud deployment is verified so only the hosted worker receives production calls.

## Data handling

- Audio frames are streamed directly from the SIP track into LiveKit Inference and are not written to disk or object storage.
- Only finalized transcript text is buffered in process memory. Interim transcript events are ignored.
- LiveKit documents Inference as zero-data-retention by default, including audio and model outputs. T-Gate transcript retention is still TBD; this worker currently drops the transcript after classification.
- Logs contain only opaque IDs and classification metadata, never caller numbers or transcript text.

## Current limits

- English transcription only, matching Universal-Streaming's documented language support.
- The existing classifier is trained on text messages. Call-level accuracy, transcript windowing, and thresholds are not validated by this worker.
- This task does not store results or expose them to the Vercel app.
- A consented call verified the local route: SIP status changed from `ringing` to `active`, the worker transcribed non-empty caller speech, then the call ended. The classifier is not configured and no verdict or UI result is produced yet.
