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
import { publishSilenceTrack } from './silence.js';
import { transcribeCallerTrack } from './transcribe.js';

dotenv.config({ path: '.env' });

/** Placeholder handle when the SIP participant has no caller number (masked as ***-***-0000). */
const UNKNOWN_CALLER = '+10000000000';

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
    let resolveCallerTrack: ((track: RemoteTrack | null) => void) | undefined;
    let callerTrackResolved = false;
    const callerTrackPromise = new Promise<RemoteTrack | null>((resolve) => {
      resolveCallerTrack = resolve;
    });

    ctx.room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (
        !callerTrackResolved &&
        participant.kind === ParticipantKind.SIP &&
        track.kind === TrackKind.KIND_AUDIO
      ) {
        callerTrackResolved = true;
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
        console.info(JSON.stringify({ event: 'sip_call_status', status: callStatus }));
      }
    });
    ctx.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      if (!callerTrackResolved && participant.kind === ParticipantKind.SIP) {
        callerTrackResolved = true;
        resolveCallerTrack?.(null);
      }
    });

    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);
    let stopSilenceTrack: (() => Promise<void>) | undefined;
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
      let transcript = '';
      try {
        transcript = await transcribeCallerTrack(callerTrack);
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
