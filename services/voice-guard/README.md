# Voice guard worker

This LiveKit Agents worker is the caller-only receiver for the voice scam guard. It filters for SIP participant audio, streams it to AssemblyAI Universal-Streaming through LiveKit Inference, keeps finalized transcript text in memory, and submits that text to the existing classifier after the audio track ends when the classifier is configured. When the Vercel result endpoint and ingest token are configured, it posts the transcript and classifier fields to the protected call-results API. It publishes a zero-amplitude audio track to complete LiveKit's SIP answer handshake; it does not send speech or caller audio back to the caller. It never persists audio or logs transcript text.

The transcript is sent to `POST {CLASSIFIER_URL}/classify` as `{ messageId, text }`, where `messageId` is a random UUID. No phone number, SIP identifier, or LiveKit room name is sent to the classifier. If configured, the worker then submits `{ callId, transcript, label, score, category, model, completedAt }` to `VOICE_GUARD_RESULTS_URL`; result submission is authenticated and does not affect call completion.

## Local setup

1. Copy `.env.example` to `.env` and set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` from LiveKit Cloud.
2. Leave `VOICE_GUARD_CAPTURE_ENABLED=false` until a consented test call is authorized. This default keeps the worker from connecting to the room or subscribing to call audio.
3. Set `CLASSIFIER_URL` to the classifier service base URL and `CLASSIFIER_TOKEN` to its bearer token when the classifier is available. If unset, the worker transcribes in memory but skips classification.
4. For result display, set `VOICE_GUARD_RESULTS_URL` to the full `https://<vercel-site>/api/voice/calls` URL and set `VOICE_GUARD_RESULTS_INGEST_TOKEN` to the same value configured in Vercel. Leave both unset to skip result storage.
5. Install dependencies with `npm install`.
6. Start the worker with `npm run dev`.

## Local end-to-end call result demo

Run the web app and voice worker locally while the worker still joins the configured LiveKit Cloud room. Do not use the sample tokens below outside local development.

1. Start the classifier service on the laptop at `http://127.0.0.1:8000`. The service needs `classifier/artifacts/model.json` and the matching model files; those artifacts are not committed. The repo instructions prohibit training the production model on the laptop, so use an existing local artifact set or point `CLASSIFIER_URL` at an available classifier endpoint instead.

   ```bash
   cd classifier
   CLASSIFIER_TOKEN=local-dev-classifier-token uvicorn service.app:app --host 127.0.0.1 --port 8000
   ```

2. In `apps/web/.env.local`, set the local-only result credentials and TTL, and leave `MONGODB_URI` empty to use the development process-memory store:

   ```dotenv
   VOICE_GUARD_RESULTS_INGEST_TOKEN=local-dev-ingest-token
   VOICE_GUARD_RESULTS_VIEW_TOKEN=local-dev-view-token
   VOICE_GUARD_RESULTS_TTL_SECONDS=3600
   MONGODB_URI=
   ```

   Then run `npm run dev` from `apps/web`.

3. In the voice worker's local `.env`, configure:

   ```dotenv
   VOICE_GUARD_CAPTURE_ENABLED=true
   CLASSIFIER_URL=http://127.0.0.1:8000
   CLASSIFIER_TOKEN=local-dev-classifier-token
   VOICE_GUARD_RESULTS_URL=http://127.0.0.1:3000/api/voice/calls
   VOICE_GUARD_RESULTS_INGEST_TOKEN=local-dev-ingest-token
   ```

   Start it with `npm run dev` from `services/voice-guard`.

4. Open `http://localhost:3000/voice`, enter `local-dev-view-token`, then place a consented call. After hangup, the page polls every five seconds and displays the transcript and classifier result. Local-memory results disappear when `next dev` restarts; no audio or durable transcript is written locally.

If `classifier/artifacts/` is absent, step 1 cannot start; use a running classifier endpoint in `CLASSIFIER_URL` or make the trained model artifacts available before placing a call.

The `T-Gate Voice` inbound SIP dispatch rule targets agent name `voice-guard`. Set `VOICE_GUARD_CAPTURE_ENABLED=true` only for an authorized, consented call. The worker publishes silence so the caller is answered, then listens to caller audio; spoken response remains out of scope.

## Container and LiveKit Cloud deployment

The Dockerfile compiles TypeScript into `dist/` and runs `node dist/agent.js start` as an unprivileged user. `.dockerignore` excludes local `.env` files and build artifacts. Build locally with `npm run build`; the container image installs production dependencies only.

The selected host is LiveKit Cloud. The production `voice-guard` agent is deployed in `us-east`, is running with one ready replica, and is registered under the expected agent name. It has `VOICE_GUARD_CAPTURE_ENABLED=true`; LiveKit injects `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`. The local `.env` is excluded from the deployment source archive. `CLASSIFIER_URL` and `CLASSIFIER_TOKEN` are not configured in Cloud, so the current deployment answers and transcribes but skips classification. To publish results after deploying the combined worker, also set `VOICE_GUARD_RESULTS_URL=https://<vercel-site>/api/voice/calls` and `VOICE_GUARD_RESULTS_INGEST_TOKEN` to the matching Vercel secret.

The current Build plan includes 1,000 agent session minutes, 1,000 third-party SIP minutes, and $2.50 of LiveKit Inference allowance. Production workers can cold-start after idle, adding up to 10–20 seconds before joining a call. The worker is registered, but production dispatch has not been verified with a post-deployment call.

## Data handling

- Audio frames are streamed directly from the SIP track into LiveKit Inference and are not written to disk or object storage.
- Only finalized transcript text is buffered in process memory before classification. Interim transcript events are ignored.
- When configured, the final transcript and verdict are sent over HTTPS to the Vercel call-results endpoint. Vercel accepts the result only when `VOICE_GUARD_RESULTS_INGEST_TOKEN`, `VOICE_GUARD_RESULTS_VIEW_TOKEN`, `VOICE_GUARD_RESULTS_TTL_SECONDS`, and `MONGODB_URI` are configured. The TTL has no default; records expire from the dedicated Atlas collection, and reads immediately filter expired records. The viewer token is typed into `/voice` and kept in page memory only.
- LiveKit documents Inference as zero-data-retention by default, including audio and model outputs. T-Gate transcript retention duration is still TBD. If result submission is not configured, the worker drops the transcript after classification; if enabled, Vercel stores it only through the explicitly configured TTL.
- Logs contain only opaque IDs and classification metadata, never caller numbers or transcript text.

## Current limits

- English transcription only, matching Universal-Streaming's documented language support.
- The existing classifier is trained on text messages. Call-level accuracy, transcript windowing, and thresholds are not validated by this worker.
- Vercel result storage and display are implemented in the follow-on task, but remain disabled until the owner configures the explicit retention TTL and view/ingest tokens.
- A consented call verified the local route: SIP status changed from `ringing` to `active`, the worker transcribed non-empty caller speech, then the call ended. The classifier is not configured and no verdict or UI result is produced yet.
