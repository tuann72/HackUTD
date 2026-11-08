// Server-side call control for the live call: dial the victim into the room over the outbound SIP
// trunk, keep the caller off the whisper track, and hang up one side when the other leaves.
import { RoomServiceClient, SipClient } from 'livekit-server-sdk';
import type { LiveCallConfig } from './config.js';

/** Identity of the victim's SIP leg. The agent never transcribes it. */
export const VICTIM_IDENTITY = 'tguard-victim';

function apiHost(): string {
  const url = process.env.LIVEKIT_URL ?? '';
  return url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
}

export class LiveCallControl {
  private readonly rooms: RoomServiceClient;
  private readonly sip: SipClient;

  constructor(private readonly roomName: string) {
    const host = apiHost();
    this.rooms = new RoomServiceClient(host, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
    this.sip = new SipClient(host, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
  }

  /** Rings the victim's phone. Resolves once the dial request is accepted, not when they answer. */
  async dialVictim(config: LiveCallConfig): Promise<void> {
    await this.sip.createSipParticipant(config.outboundTrunkId, config.victimPhone, this.roomName, {
      participantIdentity: VICTIM_IDENTITY,
      participantName: 'T-Guard protected line',
      ...(config.fromNumber ? { fromNumber: config.fromNumber } : {}),
      ringingTimeout: config.ringingTimeoutSeconds,
      playDialtone: false,
      waitUntilAnswered: false,
    });
  }

  /** Stops `identity` from receiving the given tracks (the caller and the whisper track). */
  async unsubscribe(identity: string, trackSids: string[]): Promise<void> {
    await this.rooms.updateSubscriptions(this.roomName, identity, trackSids, false);
  }

  /** Hangs up one participant (a SIP participant's call ends when it is removed). */
  async hangUp(identity: string): Promise<void> {
    await this.rooms.removeParticipant(this.roomName, identity);
  }
}
