# Live call setup: what a person has to do (LacsJP27)

The code for the live call (victim dialed in on a real phone, live scoring, whisper warning) is on `feat/voice-guard-live-call` (PR #87). Everything is off until these are configured. Never paste the secret values into the repo or a PR.

## 1. Outbound SIP trunk (blocking: the victim can't be dialed without it)

LiveKit needs an **outbound** trunk to call a real phone. Check first whether Photon allows outbound calls from the voice line (Photon 2.0 dashboard → the voice number → Voice profile; look for outbound/termination SIP credentials). If Photon has no outbound SIP, create a SIP trunk with a provider such as Telnyx or Twilio Elastic SIP Trunking (a termination URI, credentials, and a number to call from).

Then create the trunk in LiveKit (dashboard → Telephony → SIP trunks → Outbound, or the CLI):

```bash
lk sip outbound create outbound-trunk.json   # address, numbers [caller ID], auth username/password
```

Copy the trunk id (`ST_...`).

## 2. Gateway on the VM

In `/opt/t-gate/HackUTD/services/gateway/.env`:

```dotenv
VOICE_SCORE_TOKEN=<new long random value, e.g. openssl rand -hex 32>
# optional: VOICE_WARN_THRESHOLD=0.7   (defaults to BLOCK_THRESHOLD)
```

Deploy this branch's gateway code (after merge), then `sudo systemctl restart t-gate-gateway`. The log should say `voice score=on`.

## 3. LiveKit Cloud agent secrets

| Secret | Value |
|---|---|
| `VOICE_GUARD_VICTIM_PHONE` | Victim's real phone, E.164 (`+1...`) |
| `LIVEKIT_SIP_OUTBOUND_TRUNK_ID` | `ST_...` from step 1 |
| `VOICE_GUARD_CALLER_ID` | Optional: number the victim sees (must be allowed by the trunk) |
| `VOICE_SCORE_URL` | `https://<gateway-host>/voice/score` |
| `VOICE_SCORE_TOKEN` | Same value as the gateway's `VOICE_SCORE_TOKEN` |

`GATEWAY_WEBHOOK_URL` / `GATEWAY_WEBHOOK_SECRET` stay as they are (and must match the gateway's `PHOTON_WEBHOOK_SECRET`; the last call failed with 401 because they didn't).

Then redeploy: `cd services/voice-guard && lk agent deploy`.

## 4. Test call (consented)

1. From phone A (the "scammer"), call the Photon voice number. Phone B (the victim) should ring.
2. Answer on B, talk. Read a scam script from A (e.g. "This is the IRS, you owe back taxes, pay today with gift cards or you'll be arrested").
3. B should hear the T-Guard warning a few seconds later; A should not.
4. Hang up either phone; the other should drop, and the call should show on `/messages`.
5. Trace with `lk agent logs` (events listed in `services/voice-guard/README.md`, "Live call").

## Things that may need a fix after the first real call

- If A also hears the warning: `updateSubscriptions` doesn't hold for SIP participants. Remove `VOICE_SCORE_*` to turn the whisper off and tell Claude.
- If there's `whisper_unavailable` with a TTS error: set `VOICE_GUARD_TTS_MODEL` / `VOICE_GUARD_TTS_VOICE` to a model and voice your LiveKit Inference plan supports (for example `deepgram/aura-2`).
- If `victim_dial_failed`: the trunk config or caller ID is wrong. The error text is in the log.
