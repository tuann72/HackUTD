# Voice guard worker

This LiveKit Agents worker is the caller-only receiver for the voice scam guard. It filters for SIP participant audio, streams it to AssemblyAI Universal-Streaming through LiveKit Inference, keeps finalized transcript text in memory, and submits that text to the existing classifier after the audio track ends. It does not publish audio, generate a spoken response, persist audio/transcripts/results, or log transcript text.

The transcript is sent to `POST {CLASSIFIER_URL}/classify` as `{ messageId, text }`, where `messageId` is a random UUID. No phone number, SIP identifier, or LiveKit room name is sent to the classifier. Call-result storage and the read-only UI API are later feature tasks.

## Local setup

1. Copy `.env.example` to `.env` and set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` from LiveKit Cloud.
2. Leave `VOICE_GUARD_CAPTURE_ENABLED=false` until a consented test call is authorized. This default keeps the worker from connecting to the room or subscribing to call audio.
3. Set `CLASSIFIER_URL` to the classifier service base URL and `CLASSIFIER_TOKEN` to its bearer token when the classifier is available. If unset, the worker transcribes in memory but skips classification.
4. Install dependencies with `npm install`.
5. Start the worker with `npm run dev`.

To make the inbound SIP dispatch rule use this worker, set its agent name to `voice-guard`. The existing dispatch rule currently has no agent attached. Do this only for an authorized, consented test call after the worker is deployed and `VOICE_GUARD_CAPTURE_ENABLED=true`; an attached, enabled worker will answer and transcribe inbound calls routed by that rule. The worker intentionally stays silent, because spoken response is out of scope.

## Data handling

- Audio frames are streamed directly from the SIP track into LiveKit Inference and are not written to disk or object storage.
- Only finalized transcript text is buffered in process memory. Interim transcript events are ignored.
- LiveKit documents Inference as zero-data-retention by default, including audio and model outputs. T-Gate transcript retention is still TBD; this worker currently drops the transcript after classification.
- Logs contain only opaque IDs and classification metadata, never caller numbers or transcript text.

## Current limits

- English transcription only, matching Universal-Streaming's documented language support.
- The existing classifier is trained on text messages. Call-level accuracy, transcript windowing, and thresholds are not validated by this worker.
- This task does not store results or expose them to the Vercel app.
- The SIP route has not been verified with this worker. No call or inference usage test has been run.
