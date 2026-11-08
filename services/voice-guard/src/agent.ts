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
import { classifyTranscript } from './classifier.js';
import { readConfig } from './config.js';
import { publishSilenceTrack } from './silence.js';
import { transcribeCallerTrack } from './transcribe.js';

dotenv.config({ path: '.env' });

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

      if (!config.classifierUrl || !config.classifierToken) {
        console.info(JSON.stringify({ event: 'classifier_not_configured', messageId }));
        return;
      }

      try {
        const result = await classifyTranscript(
          {
            baseUrl: config.classifierUrl,
            token: config.classifierToken,
            timeoutMs: config.classifierTimeoutMs,
          },
          messageId,
          transcript,
        );
        console.info(
          JSON.stringify({
            event: 'call_classified',
            messageId,
            label: result.label,
            score: result.score,
            category: result.category,
            model: result.model,
          }),
        );
      } catch {
        console.warn(JSON.stringify({ event: 'classification_unavailable', messageId }));
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
