import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  TrackPublishOptions,
  TrackSource,
  type LocalParticipant,
} from '@livekit/rtc-node';

const SAMPLE_RATE = 24_000;
const CHANNELS = 1;
const FRAME_MS = 20;
const SAMPLES_PER_FRAME = (SAMPLE_RATE * FRAME_MS) / 1000;

/**
 * Publishes a zero-amplitude audio track so the inbound SIP caller can complete
 * LiveKit's answer handshake. It carries no spoken response or caller audio.
 */
export async function publishSilenceTrack(
  participant: LocalParticipant,
): Promise<() => Promise<void>> {
  const source = new AudioSource(SAMPLE_RATE, CHANNELS);
  const track = LocalAudioTrack.createAudioTrack('voice-guard-silence', source);

  let publication;
  try {
    publication = await participant.publishTrack(
      track,
      new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
    );
  } catch (error) {
    await track.close();
    throw error;
  }

  let running = true;
  const silentFrame = AudioFrame.create(SAMPLE_RATE, CHANNELS, SAMPLES_PER_FRAME);
  const pump = (async () => {
    while (running) {
      await source.captureFrame(silentFrame);
      await new Promise<void>((resolve) => setTimeout(resolve, FRAME_MS));
    }
  })().catch((error: unknown) => {
    running = false;
    console.error(
      JSON.stringify({
        event: 'silent_audio_stream_failed',
        error: error instanceof Error ? error.message : 'unknown error',
      }),
    );
  });

  return async () => {
    running = false;
    await pump;
    try {
      if (publication.sid) await participant.unpublishTrack(publication.sid, false);
    } finally {
      await track.close();
    }
  };
}
