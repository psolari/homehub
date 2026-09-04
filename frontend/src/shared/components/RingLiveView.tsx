import { useEffect, useRef, useState } from "react";
import * as mdi from "@mdi/js";
import Icon from "@mdi/react";

import { apiUrl, get, post } from "../api/client";
import type { Device } from "../types";

type LiveViewConfig = {
  supported: boolean;
  ice_servers: RTCIceServer[];
  audio_receive: boolean;
  talkback: boolean;
};

type LiveViewStart = {
  session_id: string;
  ice_servers: RTCIceServer[];
};

type SignalMessage =
  | { seq: number; type: "answer"; sdp: string }
  | {
      seq: number;
      type: "candidate";
      candidate: string;
      sdp_m_line_index: number;
    }
  | { seq: number; type: "error"; code?: string; message: string };

type SignalResponse = {
  session_id: string;
  cursor: number;
  messages: SignalMessage[];
};

const paths = mdi as unknown as Record<string, string>;

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function RingLiveView({
  device,
  onStop,
}: {
  device: Device;
  onStop: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const senderRef = useRef<RTCRtpSender | null>(null);
  const microphoneRef = useRef<MediaStream | null>(null);
  const talkHeldRef = useRef(false);
  const stoppedRef = useRef(false);
  const sessionRef = useRef("");
  const [status, setStatus] = useState("Starting Ring Live View…");
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [talking, setTalking] = useState(false);
  const [connected, setConnected] = useState(false);
  const [needsPlay, setNeedsPlay] = useState(false);
  const [talkbackAvailable, setTalkbackAvailable] = useState(true);

  const sendCandidate = async (
    sessionId: string,
    candidate: RTCIceCandidate,
  ) => {
    await post(`/devices/${device.id}/live-view/candidate/`, {
      session_id: sessionId,
      candidate: candidate.candidate,
      sdp_m_line_index: candidate.sdpMLineIndex ?? 0,
    });
  };

  const endMicrophone = async () => {
    setTalking(false);
    try {
      await senderRef.current?.replaceTrack(null);
    } catch {
      // Peer may already be closing.
    }
    microphoneRef.current?.getTracks().forEach((track) => track.stop());
    microphoneRef.current = null;
  };

  const stopBackend = (sessionId: string) => {
    if (!sessionId) return;
    void fetch(apiUrl(`/devices/${device.id}/live-view/stop/`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
      keepalive: true,
    }).catch(() => undefined);
  };

  const stop = async (notifyParent = true) => {
    if (stoppedRef.current) {
      if (notifyParent) onStop();
      return;
    }
    stoppedRef.current = true;
    await endMicrophone();
    const sessionId = sessionRef.current;
    sessionRef.current = "";
    peerRef.current?.close();
    peerRef.current = null;
    stopBackend(sessionId);
    if (notifyParent) onStop();
  };

  useEffect(() => {
    let cancelled = false;
    let cursor = 0;
    let signalStarted = false;
    const pendingLocalCandidates: RTCIceCandidate[] = [];
    const pendingRemoteCandidates: RTCIceCandidateInit[] = [];

    const applyRemoteCandidate = async (
      pc: RTCPeerConnection,
      candidate: RTCIceCandidateInit,
    ) => {
      if (!pc.remoteDescription) {
        pendingRemoteCandidates.push(candidate);
        return;
      }
      await pc.addIceCandidate(candidate);
    };

    let liveConnected = false;

    const pollMessages = async (
      pc: RTCPeerConnection,
      sessionId: string,
    ) => {
      while (!cancelled && !stoppedRef.current) {
        try {
          const response = await get<SignalResponse>(
            `/devices/${device.id}/live-view/messages/?session_id=${encodeURIComponent(
              sessionId,
            )}&after=${cursor}`,
          );
          cursor = response.cursor;

          for (const message of response.messages) {
            if (message.type === "answer") {
              await pc.setRemoteDescription({
                type: "answer",
                sdp: message.sdp,
              });
              while (pendingRemoteCandidates.length) {
                const candidate = pendingRemoteCandidates.shift();
                if (candidate) await pc.addIceCandidate(candidate);
              }
              setStatus("Connecting to Front Door…");
            } else if (message.type === "candidate") {
              await applyRemoteCandidate(pc, {
                candidate: message.candidate,
                sdpMLineIndex: message.sdp_m_line_index,
              });
            } else if (message.type === "error") {
              throw new Error(
                message.message ||
                  `Ring Live View ended (${message.code || "unknown"})`,
              );
            }
          }
        } catch (reason) {
          if (!cancelled && !stoppedRef.current) {
            setError(
              reason instanceof Error
                ? reason.message
                : "Ring Live View signaling failed.",
            );
            setStatus("Live View stopped");
          }
          return;
        }

        await sleep(liveConnected ? 1000 : 300);
      }
    };

    const start = async () => {
      try {
        setError("");
        setStatus("Preparing secure WebRTC connection…");

        const config = await get<LiveViewConfig>(
          `/devices/${device.id}/live-view/config/`,
        );
        if (!config.supported) {
          throw new Error("Ring Live View is not supported for this device.");
        }
        if (cancelled) return;

        setTalkbackAvailable(
          config.talkback &&
            window.isSecureContext &&
            Boolean(navigator.mediaDevices?.getUserMedia),
        );

        const pc = new RTCPeerConnection({
          iceServers: config.ice_servers,
          bundlePolicy: "max-bundle",
        });
        peerRef.current = pc;

        const remoteStream = new MediaStream();
        if (videoRef.current) {
          videoRef.current.srcObject = remoteStream;
          videoRef.current.muted = muted;
        }

        pc.ontrack = (event) => {
          const track = event.track;
          if (!remoteStream.getTracks().some((item) => item.id === track.id)) {
            remoteStream.addTrack(track);
          }
          if (videoRef.current) {
            videoRef.current.srcObject = remoteStream;
            void videoRef.current.play().then(
              () => setNeedsPlay(false),
              () => setNeedsPlay(true),
            );
          }
        };

        pc.onconnectionstatechange = () => {
          if (cancelled) return;
          if (pc.connectionState === "connected") {
            liveConnected = true;
            setConnected(true);
            setStatus("Live");
            setError("");
          } else if (
            pc.connectionState === "failed" ||
            pc.connectionState === "closed"
          ) {
            liveConnected = false;
            setConnected(false);
            setStatus("Live View stopped");
            if (pc.connectionState === "failed") {
              setError(
                "The Ring WebRTC connection failed. End Live View and try again.",
              );
            }
          } else if (pc.connectionState === "disconnected") {
            liveConnected = false;
            setStatus("Reconnecting…");
          }
        };

        const videoTransceiver = pc.addTransceiver("video", {
          direction: "recvonly",
        });
        const audioTransceiver = pc.addTransceiver("audio", {
          direction: "sendrecv",
        });
        senderRef.current = audioTransceiver.sender;

        pc.onicecandidate = (event) => {
          if (!event.candidate || cancelled || stoppedRef.current) return;
          if (!signalStarted || !sessionRef.current) {
            pendingLocalCandidates.push(event.candidate);
            return;
          }
          void sendCandidate(sessionRef.current, event.candidate).catch(
            (reason) => {
              if (!cancelled) {
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "Could not send a WebRTC network candidate to Ring.",
                );
              }
            },
          );
        };

        // Keep explicit references so browsers do not garbage collect the
        // transceivers while the offer is being negotiated.
        void videoTransceiver;

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (!pc.localDescription?.sdp) {
          throw new Error("Browser did not create a WebRTC offer.");
        }

        const sessionId = crypto.randomUUID();
        sessionRef.current = sessionId;
        setStatus("Starting Ring camera…");

        const started = await post<LiveViewStart>(
          `/devices/${device.id}/live-view/start/`,
          {
            session_id: sessionId,
            offer: pc.localDescription.sdp,
          },
        );
        if (cancelled) {
          stopBackend(sessionId);
          return;
        }

        sessionRef.current = started.session_id;
        signalStarted = true;

        for (const candidate of pendingLocalCandidates.splice(0)) {
          await sendCandidate(started.session_id, candidate);
        }

        void pollMessages(pc, started.session_id);
      } catch (reason) {
        if (!cancelled) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not start Ring Live View.",
          );
          setStatus("Live View unavailable");
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      void stop(false);
    };
    // Device change means a completely new Ring WebRTC session.
  }, [device.id]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  const startTalking = async () => {
    if (talking || !talkbackAvailable || !senderRef.current) return;
    talkHeldRef.current = true;
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (!talkHeldRef.current || stoppedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      microphoneRef.current = stream;
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error("Browser did not provide a microphone track.");
      await senderRef.current.replaceTrack(track);
      if (!talkHeldRef.current || stoppedRef.current) {
        await senderRef.current.replaceTrack(null);
        stream.getTracks().forEach((item) => item.stop());
        microphoneRef.current = null;
        return;
      }
      setTalking(true);
    } catch (reason) {
      microphoneRef.current?.getTracks().forEach((track) => track.stop());
      microphoneRef.current = null;
      setTalking(false);
      setError(
        reason instanceof Error
          ? reason.message
          : "HomeHub could not access your microphone.",
      );
    }
  };

  const releaseTalk = async () => {
    talkHeldRef.current = false;
    await endMicrophone();
  };

  const enablePlayback = async () => {
    try {
      await videoRef.current?.play();
      setNeedsPlay(false);
    } catch {
      setError(
        "Your browser blocked live audio playback. Check the site's autoplay/audio permission.",
      );
    }
  };

  return (
    <div className="space-y-3">
      <div className="relative aspect-video overflow-hidden rounded-xl border border-zinc-800 bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="h-full w-full object-contain"
        />
        {!connected && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 px-6 text-center text-sm text-zinc-300">
            {status}
          </div>
        )}
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/65 px-2.5 py-1 text-[10px] uppercase tracking-[.12em] text-zinc-200 backdrop-blur">
          <span
            className={`h-2 w-2 rounded-full ${
              connected ? "bg-red-500 animate-pulse" : "bg-zinc-600"
            }`}
          />
          {connected ? "Live" : status}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs leading-5 text-amber-300">
          {error}
        </div>
      )}

      {!talkbackAvailable && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-[11px] leading-4 text-zinc-500">
          Live audio can still play, but microphone talkback requires a secure
          browser context. Use HomeHub on localhost or HTTPS to enable it.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setMuted((value) => !value)}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:text-white"
        >
          <Icon
            path={muted ? paths.mdiVolumeOff : paths.mdiVolumeHigh}
            size={0.62}
          />
          {muted ? "Unmute" : "Mute"}
        </button>

        {needsPlay && (
          <button
            type="button"
            onClick={() => void enablePlayback()}
            className="inline-flex items-center gap-2 rounded-lg border border-cyan-800 px-3 py-2 text-xs text-cyan-300"
          >
            <Icon path={paths.mdiVolumeHigh} size={0.62} />
            Enable live audio
          </button>
        )}

        <button
          type="button"
          disabled={!connected || !talkbackAvailable}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            void startTalking();
          }}
          onPointerUp={() => void releaseTalk()}
          onPointerCancel={() => void releaseTalk()}
          onLostPointerCapture={() => {
            if (talkHeldRef.current || talking) void releaseTalk();
          }}
          className={`inline-flex select-none items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
            talking
              ? "border-red-500 bg-red-500 text-white"
              : "border-zinc-700 text-zinc-300 hover:border-cyan-700 hover:text-white"
          }`}
          title="Hold this button while speaking through the Ring doorbell"
        >
          <Icon
            path={talking ? paths.mdiMicrophone : paths.mdiMicrophoneOutline}
            size={0.62}
          />
          {talking ? "Talking…" : "Hold to talk"}
        </button>

        <button
          type="button"
          onClick={() => void stop(true)}
          className="ml-auto inline-flex items-center gap-2 rounded-lg border border-red-900/70 px-3 py-2 text-xs text-red-400 hover:bg-red-950/30"
        >
          <Icon path={paths.mdiPhoneHangup} size={0.62} />
          End Live View
        </button>
      </div>
    </div>
  );
}
