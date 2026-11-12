import { SIGNS_CHANNEL, STUN_URL, parseSignsChannelMessage } from "@familyguide/shared";
import type { SignsChannelMessage } from "@familyguide/shared";
import { errorMessage } from "./join.ts";

// Public STUN only. No TURN server, paid or free.
export type IceServers = { iceServers: [{ urls: typeof STUN_URL }] };

export type DisconnectReason = "ice_failed" | "ended";

const ICE_FAILED_MESSAGE = "לא הצלחנו להתחבר ישירות. נסו רשת אחרת או לקרב את שני הטלפונים.";

export function disconnectMessage(reason: DisconnectReason): string {
  return reason === "ice_failed" ? ICE_FAILED_MESSAGE : errorMessage("disconnected");
}

export type HelperPeer = {
  handleSignal(payload: unknown): Promise<void>;
  getSignsChannel(): RTCDataChannel;
  hangup(): void;
};

export type HelperPeerOptions = {
  sendSignal: (payload: unknown) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onSignsMessage: (msg: SignsChannelMessage) => void;
  onDisconnected: (reason: DisconnectReason) => void;
  /** Sends {type:"hangup"} on the signaling WebSocket. */
  sendHangup?: () => void;
  /** Test seam: defaults to the browser RTCPeerConnection. */
  peerFactory?: (config: RTCConfiguration) => RTCPeerConnection;
};

// Signal payloads: {type:"offer"|"answer", sdp} or {type:"candidate", candidate}.
// A JSON string payload (as sent by the Android app) is accepted too.
function parseSignal(payload: unknown): Record<string, unknown> | null {
  let value = payload;
  if (typeof payload === "string") {
    try {
      value = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

export async function createHelperPeer(opts: HelperPeerOptions): Promise<HelperPeer> {
  const iceConfig: IceServers = { iceServers: [{ urls: STUN_URL }] };
  const factory = opts.peerFactory ?? ((config: RTCConfiguration) => new RTCPeerConnection(config));
  const pc = factory(iceConfig);

  let signsChannel: RTCDataChannel | null = null;
  let ended = false;
  let pendingCandidates: RTCIceCandidateInit[] = [];

  pc.ontrack = (event) => {
    if (event.track.kind !== "video") return;
    opts.onRemoteStream(event.streams[0] ?? new MediaStream([event.track]));
  };

  pc.ondatachannel = (event) => {
    const channel = event.channel;
    if (channel.label !== SIGNS_CHANNEL) {
      channel.close();
      return;
    }
    signsChannel = channel;
    channel.onmessage = (msgEvent) => {
      if (typeof msgEvent.data !== "string") return;
      let data: unknown;
      try {
        data = JSON.parse(msgEvent.data);
      } catch {
        return;
      }
      const msg = parseSignsChannelMessage(data);
      if (msg) opts.onSignsMessage(msg);
    };
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) opts.sendSignal({ type: "candidate", candidate: event.candidate.toJSON() });
  };

  function close(): void {
    ended = true;
    signsChannel?.close();
    pc.close();
  }

  pc.onconnectionstatechange = () => {
    if (ended) return;
    if (pc.connectionState === "failed") {
      close();
      opts.onDisconnected("ice_failed");
    }
  };

  return {
    async handleSignal(payload) {
      if (ended) return;
      const signal = parseSignal(payload);
      if (!signal) return;
      if (signal.type === "offer" && typeof signal.sdp === "string") {
        await pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        opts.sendSignal({ type: "answer", sdp: answer.sdp });
        const queued = pendingCandidates;
        pendingCandidates = [];
        for (const candidate of queued) await pc.addIceCandidate(candidate);
      } else if (signal.type === "candidate" && typeof signal.candidate === "object" && signal.candidate) {
        const candidate = signal.candidate as RTCIceCandidateInit;
        if (pc.remoteDescription) await pc.addIceCandidate(candidate);
        else pendingCandidates.push(candidate);
      }
    },
    getSignsChannel() {
      if (!signsChannel) throw new Error("signs channel has not been opened by the elder yet");
      return signsChannel;
    },
    hangup() {
      if (ended) return;
      close();
      opts.sendHangup?.();
    },
  };
}
