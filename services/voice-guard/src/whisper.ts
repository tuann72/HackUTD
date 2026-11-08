// The whisper: a second audio track that only the victim receives. It is published silent at call
// start, the caller is unsubscribed from it server-side (see livecall.ts), and the warning is spoken
// into it once. LiveKit's Node SDK has no client-side track permissions, so isolation relies on
// RoomServiceClient.updateSubscriptions.
import { inference } from '@livekit/agents';
import {
  AudioFrame,
  AudioResampler,
  AudioSource,
  LocalAudioTrack,
  TrackPublishOptions,
  TrackSource,
  type LocalParticipant,
} from '@livekit/rtc-node';

const SAMPLE_RATE = 24_000;
const CHANNELS = 1;

export interface WhisperTrack {
  /** Track sid, for unsubscribing the caller. */
  sid: string;
  /** Speaks the pre-synthesized warning. Resolves when playout finishes. */
  speak(): Promise<void>;
  stop(): Promise<void>;
}

async function synthesize(text: string, model: string, voice: string | undefined): Promise<AudioFrame[]> {
  const tts = new inference.TTS({ model, ...(voice ? { voice } : {}), sampleRate: SAMPLE_RATE });
  const frames: AudioFrame[] = [];
  let resampler: AudioResampler | undefined;
  const stream = tts.synthesize(text);
  try {
    for await (const audio of stream) {
      const frame = audio.frame;
      if (frame.sampleRate === SAMPLE_RATE && frame.channels === CHANNELS) {
        frames.push(frame);
      } else {
        resampler ??= new AudioResampler(frame.sampleRate, SAMPLE_RATE, CHANNELS);
        frames.push(...resampler.push(frame));
      }
    }
    if (resampler) frames.push(...resampler.flush());
  } finally {
    stream.close();
  }
  return frames;
}

export async function publishWhisperTrack(
  participant: LocalParticipant,
  opts: { text: string; ttsModel: string; ttsVoice?: string },
): Promise<WhisperTrack> {
  const source = new AudioSource(SAMPLE_RATE, CHANNELS);
  const track = LocalAudioTrack.createAudioTrack('voice-guard-whisper', source);
  const publication = await participant.publishTrack(
    track,
    new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
  );
  if (!publication.sid) {
    await track.close();
    throw new Error('whisper track has no sid');
  }

  // Synthesize ahead of time so the warning plays as soon as it's needed.
  const framesPromise = synthesize(opts.text, opts.ttsModel, opts.ttsVoice);
  framesPromise.catch(() => {}); // surfaced in speak()

  return {
    sid: publication.sid,
    async speak() {
      const frames = await framesPromise;
      for (const frame of frames) await source.captureFrame(frame);
      await source.waitForPlayout();
    },
    async stop() {
      try {
        await participant.unpublishTrack(publication.sid!, false);
      } finally {
        await track.close();
      }
    },
  };
}
