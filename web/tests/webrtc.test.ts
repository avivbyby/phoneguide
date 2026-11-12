import { describe, it, expect, vi } from "vitest";
import { SIGNS_CHANNEL, STUN_URL } from "@familyguide/shared";
import { createHelperPeer, disconnectMessage } from "../src/webrtc.ts";

class FakeChannel {
  label: string;
  readyState: RTCDataChannelState = "open";
  onmessage: ((event: { data: unknown }) => void) | null = null;
  close = vi.fn(() => {
    this.readyState = "closed";
  });
  constructor(label: string) {
    this.label = label;
  }
}

class FakePeer {
  config: RTCConfiguration;
  connectionState: RTCPeerConnectionState = "new";
  ondatachannel: ((event: { channel: FakeChannel }) => void) | null = null;
  ontrack: ((event: { track: { kind: string }; streams: unknown[] }) => void) | null = null;
  onicecandidate: ((event: { candidate: { toJSON(): unknown } | null }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  addTransceiver = vi.fn();
  addTrack = vi.fn();
  createAnswer = vi.fn(async (options?: unknown) => {
    this.answerOptions = options;
    return { type: "answer" as const, sdp: "answer-sdp" };
  });
  answerOptions: unknown;
  setRemoteDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
    this.remoteDescription = desc;
  });
  setLocalDescription = vi.fn(async () => {});
  addIceCandidate = vi.fn(async () => {});
  close = vi.fn(() => {
    this.connectionState = "closed";
  });
  constructor(config: RTCConfiguration) {
    this.config = config;
  }
}

async function setup() {
  let fake: FakePeer | undefined;
  const sendSignal = vi.fn();
  const sendHangup = vi.fn();
  const onRemoteStream = vi.fn();
  const onSignsMessage = vi.fn();
  const onDisconnected = vi.fn();
  const peer = await createHelperPeer({
    sendSignal,
    sendHangup,
    onRemoteStream,
    onSignsMessage,
    onDisconnected,
    peerFactory: (config) => {
      fake = new FakePeer(config);
      return fake as unknown as RTCPeerConnection;
    },
  });
  if (!fake) throw new Error("peerFactory was not called");
  return { peer, fake, sendSignal, sendHangup, onRemoteStream, onSignsMessage, onDisconnected };
}

describe("helper WebRTC peer", () => {
  it("uses only the approved public STUN server, no TURN", async () => {
    const { fake } = await setup();
    expect(fake.config.iceServers).toEqual([{ urls: STUN_URL }]);
    expect(JSON.stringify(fake.config)).not.toMatch(/turn/i);
  });

  it("answers an offer without adding audio", async () => {
    const { peer, fake, sendSignal } = await setup();
    await peer.handleSignal({ type: "offer", sdp: "offer-sdp" });
    expect(fake.setRemoteDescription).toHaveBeenCalledWith({ type: "offer", sdp: "offer-sdp" });
    expect(sendSignal).toHaveBeenCalledWith({ type: "answer", sdp: "answer-sdp" });
    expect(fake.addTrack).not.toHaveBeenCalled();
    expect(fake.addTransceiver).not.toHaveBeenCalled();
    expect(JSON.stringify(fake.answerOptions ?? {})).not.toMatch(/audio/i);
  });

  it("passes only video tracks to onRemoteStream", async () => {
    const { fake, onRemoteStream } = await setup();
    const stream = { id: "s" };
    fake.ontrack?.({ track: { kind: "audio" }, streams: [stream] });
    expect(onRemoteStream).not.toHaveBeenCalled();
    fake.ontrack?.({ track: { kind: "video" }, streams: [stream] });
    expect(onRemoteStream).toHaveBeenCalledWith(stream);
  });

  it("receives the signs channel from the elder and parses its messages", async () => {
    const { peer, fake, onSignsMessage } = await setup();
    const channel = new FakeChannel(SIGNS_CHANNEL);
    fake.ondatachannel?.({ channel });
    expect(peer.getSignsChannel()).toBe(channel);
    channel.onmessage?.({ data: JSON.stringify({ type: "sign", kind: "tap", x: 2, y: 0.5 }) });
    channel.onmessage?.({ data: "not json" });
    channel.onmessage?.({ data: JSON.stringify({ type: "sign", kind: "explode", x: 0, y: 0 }) });
    expect(onSignsMessage).toHaveBeenCalledTimes(1);
    expect(onSignsMessage).toHaveBeenCalledWith({ type: "sign", kind: "tap", x: 1, y: 0.5 });
  });

  it("hangup closes the channel and the peer and sends hangup on the WebSocket", async () => {
    const { peer, fake, sendHangup, onDisconnected } = await setup();
    const channel = new FakeChannel(SIGNS_CHANNEL);
    fake.ondatachannel?.({ channel });
    peer.hangup();
    expect(channel.close).toHaveBeenCalled();
    expect(channel.readyState).not.toBe("open");
    expect(fake.close).toHaveBeenCalled();
    expect(sendHangup).toHaveBeenCalledTimes(1);
    fake.onconnectionstatechange?.();
    expect(onDisconnected).not.toHaveBeenCalled();
  });

  it("reports ICE failure through onDisconnected with a translatable state", async () => {
    const { fake, onDisconnected } = await setup();
    fake.connectionState = "failed";
    fake.onconnectionstatechange?.();
    expect(onDisconnected).toHaveBeenCalledWith("ice_failed");
    expect(disconnectMessage("ice_failed")).toBe(
      "לא הצלחנו להתחבר ישירות. נסו רשת אחרת או לקרב את שני הטלפונים.",
    );
    expect(disconnectMessage("ended")).toBe("השיחה נגמרה.");
  });

  it("relays local ICE candidates and applies remote ones after the offer", async () => {
    const { peer, fake, sendSignal } = await setup();
    fake.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: "c1", sdpMid: "0" }) } });
    expect(sendSignal).toHaveBeenCalledWith({ type: "candidate", candidate: { candidate: "c1", sdpMid: "0" } });
    await peer.handleSignal({ type: "candidate", candidate: { candidate: "early", sdpMid: "0" } });
    expect(fake.addIceCandidate).not.toHaveBeenCalled();
    await peer.handleSignal(JSON.stringify({ type: "offer", sdp: "offer-sdp" }));
    expect(fake.addIceCandidate).toHaveBeenCalledWith({ candidate: "early", sdpMid: "0" });
  });
});
