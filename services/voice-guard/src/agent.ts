import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AutoSubscribe, cli, defineAgent, inference, ServerOptions } from '@livekit/agents';
import {
  ParticipantKind,
  RoomEvent,
  TrackKind,
  type LocalParticipant,
  type RemoteTrack,
} from '@livekit/rtc-node';
import dotenv from 'dotenv';
import { readConfig } from './config.js';
import { sendTranscriptToGateway } from './gateway.js';
import { LiveCallControl, VICTIM_IDENTITY } from './livecall.js';
import { LiveScorer, scoreTranscript } from './score.js';
import { publishSilenceTrack } from './silence.js';
import { transcribeCallerTrack } from './transcribe.js';
import { publishWhisperTrack, type WhisperTrack } from './whisper.js';

dotenv.config({ path: '.env' });

/** Placeholder handle when the SIP participant has no caller number (masked as ***-***-0000). */
const UNKNOWN_CALLER = '+10000000000';

const errorText = (error: unknown) => (error instanceof Error ? error.message : 'unknown error');
const log = (event: Record<string, unknown>) => console.info(JSON.stringify(event));

const missingLiveKitEnv = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'].filter(
  (name) => !process.env[name]?.trim(),
);
if (missingLiveKitEnv.length) {
  throw new Error(`Missing required LiveKit environment variables: ${missingLiveKitEnv.join(', ')}`);
}

export default defineAgent({
  entry: async (ctx) => {
    const config = readConfig();
    if (!config.captureEnabled) {
      console.info('Voice capture is disabled; no room audio will be subscribed or transcribed.');
      return;
    }

    // Caller number from the SIP participant. Sent only to the gateway, which keeps raw handles in
    // its own DB and shows them masked. Never logged.
    let callerHandle = UNKNOWN_CALLER;
    let callerIdentity: string | undefined;
    // Live call (only when configured): the victim's SIP leg and the whisper track.
    const liveCtl = config.liveCall ? new LiveCallControl(ctx.job.room?.name ?? ctx.room.name ?? '') : undefined;
    let victimActive = false;
    let callEnding = false;
    let onVictimActive: (() => void) | undefined;
    let resolveCallerTrack: ((track: RemoteTrack | null) => void) | undefined;
    let callerTrackResolved = false;
    const callerTrackPromise = new Promise<RemoteTrack | null>((resolve) => {
      resolveCallerTrack = resolve;
    });

    ctx.room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (
        !callerTrackResolved &&
        participant.kind === ParticipantKind.SIP &&
        participant.identity !== VICTIM_IDENTITY &&
        track.kind === TrackKind.KIND_AUDIO
      ) {
        callerTrackResolved = true;
        callerIdentity = participant.identity;
        callerHandle = participant.attributes['sip.phoneNumber']?.trim() || UNKNOWN_CALLER;
        resolveCallerTrack?.(track);
        console.info(
          JSON.stringify({
            event: 'caller_audio_connected',
            sipCallStatus: participant.attributes['sip.callStatus'] ?? 'unknown',
          }),
        );
      }
    });
    ctx.room.on(RoomEvent.ParticipantAttributesChanged, (attributes, participant) => {
      const callStatus = attributes['sip.callStatus'];
      if (participant.kind === ParticipantKind.SIP && typeof callStatus === 'string') {
        const victim = participant.identity === VICTIM_IDENTITY;
        console.info(JSON.stringify({ event: victim ? 'victim_call_status' : 'sip_call_status', status: callStatus }));
        if (victim && callStatus === 'active' && !victimActive) {
          victimActive = true;
          onVictimActive?.();
        }
      }
    });
    ctx.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      // Live call: when either side hangs up, end the other leg too.
      if (liveCtl && participant.kind === ParticipantKind.SIP && !callEnding) {
        const other = participant.identity === VICTIM_IDENTITY ? callerIdentity : participant.identity === callerIdentity ? VICTIM_IDENTITY : undefined;
        if (other) {
          callEnding = true;
          log({ event: participant.identity === VICTIM_IDENTITY ? 'victim_hung_up' : 'caller_hung_up' });
          liveCtl.hangUp(other).catch((error: unknown) => log({ event: 'hangup_other_failed', error: errorText(error) }));
        }
      }
      if (!callerTrackResolved && participant.kind === ParticipantKind.SIP && participant.identity !== VICTIM_IDENTITY) {
        callerTrackResolved = true;
        resolveCallerTrack?.(null);
      }
    });

    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);
    let stopSilenceTrack: (() => Promise<void>) | undefined;
    let whisper: WhisperTrack | undefined;
    let scorer: LiveScorer | undefined;
    try {
      try {
        stopSilenceTrack = await publishSilenceTrack(ctx.room.localParticipant as LocalParticipant);
        console.info(JSON.stringify({ event: 'silent_answer_audio_published' }));
      } catch (error) {
        console.error(
          JSON.stringify({
            event: 'silent_answer_audio_unavailable',
            error: error instanceof Error ? error.message : 'unknown error',
          }),
        );
      }

      const callerTrack = await callerTrackPromise;
      if (!callerTrack) {
        console.info('SIP caller left before an audio track was available.');
        return;
      }

      const messageId = randomUUID();

      // Live call: whisper track first (caller unsubscribed), then ring the victim.
      if (liveCtl && config.liveCall) {
        if (config.liveScore && callerIdentity) {
          try {
            whisper = await publishWhisperTrack(ctx.room.localParticipant as LocalParticipant, {
              text: config.liveScore.whisperText,
              ttsModel: config.liveScore.ttsModel,
              ...(config.liveScore.ttsVoice ? { ttsVoice: config.liveScore.ttsVoice } : {}),
            });
            await liveCtl.unsubscribe(callerIdentity, [whisper.sid]);
            log({ event: 'whisper_ready', messageId });
          } catch (error) {
            // Never risk the caller hearing the warning: without isolation there is no whisper.
            log({ event: 'whisper_unavailable', messageId, error: errorText(error) });
            await whisper?.stop().catch(() => {});
            whisper = undefined;
          }
        }
        try {
          await liveCtl.dialVictim(config.liveCall);
          log({ event: 'victim_dialing', messageId });
        } catch (error) {
          log({ event: 'victim_dial_failed', messageId, error: errorText(error) });
        }
      }

      // Live scoring: the caller's transcript so far, after each utterance, at most every intervalMs.
      if (config.liveScore) {
        const scoreCfg = config.liveScore;
        const speakWarning = () => {
          const w = whisper;
          if (!w || !liveCtl || !callerIdentity) {
            log({ event: 'live_warning_not_spoken', messageId, reason: 'no whisper track' });
            return;
          }
          const callerId = callerIdentity;
          // Re-apply the caller's unsubscribe right before speaking, in case they resubscribed.
          void liveCtl
            .unsubscribe(callerId, [w.sid])
            .then(() => w.speak())
            .then(() => log({ event: 'live_warning_spoken', messageId }))
            .catch((error: unknown) => log({ event: 'live_warning_failed', messageId, error: errorText(error) }));
        };
        scorer = new LiveScorer(
          scoreCfg.intervalMs,
          (text) => scoreTranscript({ url: scoreCfg.url, token: scoreCfg.token, timeoutMs: scoreCfg.timeoutMs }, messageId, text),
          (verdict) => {
            log({ event: 'live_warning', messageId, score: verdict.score, category: verdict.category });
            if (victimActive || !config.liveCall) speakWarning();
            else onVictimActive = speakWarning; // speak once the victim picks up
          },
          (event) => log({ ...event, messageId }),
        );
      }

      let transcript = '';
      try {
        transcript = await transcribeCallerTrack(callerTrack, scorer ? (u) => scorer?.addUtterance(u) : undefined);
      } catch {
        console.warn(JSON.stringify({ event: 'transcription_unavailable', messageId }));
        return;
      }

      if (!transcript) {
        console.info(JSON.stringify({ event: 'transcript_empty', messageId }));
        return;
      }

      if (!config.gatewayWebhookUrl || !config.gatewayWebhookSecret) {
        console.info(JSON.stringify({ event: 'gateway_not_configured', messageId }));
        return;
      }

      try {
        await sendTranscriptToGateway(
          {
            url: config.gatewayWebhookUrl,
            secret: config.gatewayWebhookSecret,
            line: config.victimLine,
            timeoutMs: config.gatewayTimeoutMs,
          },
          { callId: messageId, caller: callerHandle, transcript, endedAt: new Date() },
        );
        // The gateway acks before classifying; the verdict appears in its GET /api/messages.
        console.info(JSON.stringify({ event: 'transcript_sent_to_gateway', messageId }));
      } catch (error) {
        console.warn(
          JSON.stringify({
            event: 'gateway_send_failed',
            messageId,
            error: error instanceof Error ? error.message : 'unknown error',
          }),
        );
      }
    } catch {
      console.warn(JSON.stringify({ event: 'caller_session_failed' }));
    } finally {
      scorer?.stop();
      try {
        await whisper?.stop();
      } catch (error) {
        log({ event: 'whisper_cleanup_failed', error: errorText(error) });
      }
      try {
        await stopSilenceTrack?.();
      } catch (error) {
        console.error(
          JSON.stringify({
            event: 'silent_answer_audio_cleanup_failed',
            error: error instanceof Error ? error.message : 'unknown error',
          }),
        );
      }
    }
  },
});

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: 'voice-guard',
  }),
);
