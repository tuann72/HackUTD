import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AutoSubscribe, cli, defineAgent, inference, ServerOptions } from '@livekit/agents';
import {
  ParticipantKind,
  RoomEvent,
  TrackKind,
  type RemoteTrack,
} from '@livekit/rtc-node';
import dotenv from 'dotenv';
import { classifyTranscript } from './classifier.js';
import { readConfig } from './config.js';
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
      }
    });
    ctx.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      if (!callerTrackResolved && participant.kind === ParticipantKind.SIP) {
        callerTrackResolved = true;
        resolveCallerTrack?.(null);
      }
    });

    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);
    const callerTrack = await callerTrackPromise;
    if (!callerTrack) {
      console.info('SIP caller left before an audio track was available.');
      return;
    }

    const messageId = randomUUID();
    console.info(JSON.stringify({ event: 'caller_audio_connected', messageId }));

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
  },
});

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: 'voice-guard',
  }),
);
