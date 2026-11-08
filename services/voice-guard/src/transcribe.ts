import { inference, stt } from '@livekit/agents';
import { AudioStream, type RemoteTrack } from '@livekit/rtc-node';

function getTranscriptText(event: stt.SpeechEvent): string {
  return event.alternatives?.[0]?.text?.trim() ?? '';
}

/**
 * Transcribes the caller's track until it ends and returns the whole transcript.
 * `onUtterance`, when given, is called with each finalized utterance as it completes (live scoring).
 */
export async function transcribeCallerTrack(
  track: RemoteTrack,
  onUtterance?: (utterance: string) => void,
): Promise<string> {
  const model = new inference.STT({
    model: 'assemblyai/universal-streaming',
    language: 'en',
  });
  const stream = model.stream();
  const audioStream = new AudioStream(track);
  const completedUtterances: string[] = [];
  let pendingFinalFragments: string[] = [];
  let sttFailed = false;

  const consumeTranscripts = (async () => {
    try {
      for await (const event of stream) {
        const text = getTranscriptText(event);

        if (event.type === stt.SpeechEventType.FINAL_TRANSCRIPT && text) {
          pendingFinalFragments.push(text);
        } else if (event.type === stt.SpeechEventType.END_OF_SPEECH) {
          const utterance = text || pendingFinalFragments.join(' ').trim();
          if (utterance) {
            completedUtterances.push(utterance);
            try {
              onUtterance?.(utterance);
            } catch {
              // A listener failure must not stop transcription.
            }
          }
          pendingFinalFragments = [];
        }
      }
    } catch {
      // Recognition is best-effort; do not let an STT outage end the phone call.
      sttFailed = true;
    }
  })();

  try {
    for await (const audioFrame of audioStream) {
      if (!sttFailed) stream.pushFrame(audioFrame);
    }
  } finally {
    if (!sttFailed) {
      try {
        stream.endInput();
      } catch {
        sttFailed = true;
      }
    }
    if (sttFailed) stream.close();
    await consumeTranscripts;
    stream.close();
  }

  if (pendingFinalFragments.length) {
    completedUtterances.push(pendingFinalFragments.join(' ').trim());
  }

  if (sttFailed) {
    throw new Error('Speech recognition did not finish successfully');
  }

  return completedUtterances.filter(Boolean).join(' ').trim();
}
