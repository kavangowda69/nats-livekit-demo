"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  TrackToggle,
  VideoTrack,
  useParticipants,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { StringCodec, connect, type NatsConnection } from "nats.ws";

type ChatMessage = {
  id: string;
  user: string;
  text: string;
  ts: number;
};

const ROOM_NAME =
  process.env.NEXT_PUBLIC_ROOM_NAME?.trim() || "dr-gopi-demo-room";
const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL?.trim() || "";
const NATS_URL = process.env.NEXT_PUBLIC_NATS_URL?.trim() || "";

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ParticipantVideoGrid() {
  const trackRefs = useTracks([Track.Source.Camera]);

  if (!trackRefs.length) {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center rounded-3xl border border-zinc-800 bg-zinc-900/70 text-sm text-zinc-400">
        No cameras are on yet.
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-[320px] grid-cols-1 gap-4 md:grid-cols-2">
      {trackRefs.map((trackRef) => {
        const participantName =
          trackRef.participant.name ||
          trackRef.participant.identity ||
          "Participant";

        return (
          <div
            key={`${trackRef.participant.identity}-${trackRef.source}`}
            className="relative overflow-hidden rounded-3xl border border-zinc-800 bg-black"
          >
            <VideoTrack
              trackRef={trackRef}
              className="h-full min-h-[320px] w-full object-cover"
            />
            <div className="absolute bottom-3 left-3 rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-white backdrop-blur">
              {participantName}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OnlineUsersPanel() {
  const participants = useParticipants();

  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-100">Online</h2>
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs text-emerald-300">
          {participants.length}
        </span>
      </div>

      <div className="space-y-2">
        {participants.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-700 p-3 text-sm text-zinc-400">
            Nobody is in the room yet.
          </div>
        ) : (
          participants.map((participant) => {
            const name =
              participant.name || participant.identity || "Participant";

            return (
              <div
                key={participant.identity}
                className="flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-950/70 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  <span className="text-sm text-zinc-200">{name}</span>
                </div>
                <span className="text-xs text-zinc-500">
                  {participant.isLocal ? "You" : "Live"}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function RoomControls({
  onLeave,
}: {
  onLeave: () => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <TrackToggle
        source={Track.Source.Camera}
        className="rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-100 transition hover:bg-zinc-800"
      >
        Camera
      </TrackToggle>

      <TrackToggle
        source={Track.Source.Microphone}
        className="rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-100 transition hover:bg-zinc-800"
      >
        Mic
      </TrackToggle>

      <button
        onClick={onLeave}
        className="rounded-2xl border border-red-900/50 bg-red-950/60 px-4 py-2 text-sm font-medium text-red-200 transition hover:bg-red-900/50"
      >
        Leave
      </button>

      <StartAudio
        label="Enable audio"
        className="rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-100 transition hover:bg-zinc-800"
      />
    </div>
  );
}

export default function RealtimeRoom() {
  const [name, setName] = useState("");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [livekitToken, setLivekitToken] = useState<string | null>(null);
  const [shouldConnectRoom, setShouldConnectRoom] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [natsStatus, setNatsStatus] = useState<
    "idle" | "connecting" | "connected" | "disconnected" | "error"
  >("idle");

  const ncRef = useRef<NatsConnection | null>(null);
  const sc = useMemo(() => StringCodec(), []);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const joinRoom = useCallback(async () => {
    if (!name.trim()) {
      setError("Enter your name first.");
      return;
    }

    if (!LIVEKIT_URL) {
      setError(
        "Missing LIVEKIT_URL or NEXT_PUBLIC_LIVEKIT_URL in your environment."
      );
      return;
    }

    if (!NATS_URL) {
      setError("Missing NEXT_PUBLIC_NATS_URL in your environment.");
      return;
    }

    try {
      setError(null);
      setIsJoining(true);

      const res = await fetch(
        `/api/livekit-token?room=${encodeURIComponent(
          ROOM_NAME
        )}&username=${encodeURIComponent(name.trim())}`
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to fetch LiveKit token");
      }

      const data = (await res.json()) as { token: string };

      setLivekitToken(data.token);
      setShouldConnectRoom(true);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to join room";
      setError(message);
    } finally {
      setIsJoining(false);
    }
  }, [name]);

  useEffect(() => {
    if (!shouldConnectRoom || !NATS_URL || !name.trim()) {
      return;
    }

    let cancelled = false;
    let localConnection: NatsConnection | null = null;

    async function startNats() {
      try {
        setNatsStatus("connecting");

        localConnection = await connect({
          servers: NATS_URL,
          name: `${name.trim()}-browser-chat`,
        });

        if (cancelled) {
          await localConnection.close();
          return;
        }

        ncRef.current = localConnection;
        setNatsStatus("connected");

        const sub = localConnection.subscribe(`room.${ROOM_NAME}.chat`);

        (async () => {
          try {
            for await (const msg of sub) {
              const raw = sc.decode(msg.data);

              try {
                const parsed = JSON.parse(raw) as ChatMessage;

                setMessages((current) => {
                  if (current.some((m) => m.id === parsed.id)) return current;
                  return [...current, parsed].sort((a, b) => a.ts - b.ts);
                });
              } catch {
                // Ignore malformed messages
              }
            }
          } catch {
            // subscription closed
          }
        })();

        localConnection.closed().then(() => {
          if (!cancelled) {
            setNatsStatus("disconnected");
          }
        });
      } catch (err) {
        console.error("NATS connection error:", err);
        if (!cancelled) {
          setNatsStatus("error");
          setError("Could not connect to NATS. Check NEXT_PUBLIC_NATS_URL.");
        }
      }
    }

    startNats();

    return () => {
      cancelled = true;
      setNatsStatus("disconnected");

      const current = ncRef.current;
      ncRef.current = null;

      if (current) {
        void current.drain().catch(() => {
          // ignore shutdown errors
        });
      }
    };
  }, [shouldConnectRoom, name, sc]);

  const sendMessage = useCallback(async () => {
    const text = draft.trim();
    const sender = name.trim();
    const nc = ncRef.current;

    if (!text || !sender || !nc) return;

    const payload: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      user: sender,
      text,
      ts: Date.now(),
    };

    try {
      nc.publish(`room.${ROOM_NAME}.chat`, sc.encode(JSON.stringify(payload)));
      setDraft("");
    } catch (err) {
      console.error("Publish failed:", err);
      setError("Failed to send message.");
    }
  }, [draft, name, sc]);

  const leaveRoom = useCallback(() => {
    const current = ncRef.current;
    ncRef.current = null;

    if (current) {
      void current.drain().catch(() => {
        // ignore shutdown errors
      });
    }

    setShouldConnectRoom(false);
    setLivekitToken(null);
    setMessages([]);
    setDraft("");
    setNatsStatus("idle");
    setError(null);
  }, []);

  if (!LIVEKIT_URL) {
    return (
      <div className="mx-auto flex min-h-screen max-w-4xl items-center justify-center p-6">
        <div className="w-full rounded-3xl border border-red-900/50 bg-red-950/40 p-6 text-red-100">
          Missing <code className="font-mono">LIVEKIT_URL</code> or{" "}
          <code className="font-mono">NEXT_PUBLIC_LIVEKIT_URL</code>.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col p-6">
      <div className="mb-6">
        <div className="mb-2 inline-flex items-center rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1 text-xs text-zinc-300">
          NATS + LiveKit demo
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">
          Realtime collaboration room
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400 md:text-base">
          Instant room chat over NATS and live audio/video over LiveKit in one page.
        </p>
      </div>

      {!shouldConnectRoom ? (
        <div className="mx-auto mt-10 w-full max-w-xl rounded-[28px] border border-zinc-800 bg-zinc-900/70 p-6 shadow-2xl shadow-black/30">
          <h2 className="mb-2 text-xl font-semibold text-white">Join the room</h2>
          <p className="mb-5 text-sm text-zinc-400">
            Enter your name and connect to the shared demo room.
          </p>

          <label className="mb-2 block text-sm text-zinc-300">Your name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Kavan"
            className="w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-zinc-100 outline-none ring-0 transition placeholder:text-zinc-500 focus:border-zinc-500"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void joinRoom();
              }
            }}
          />

          {error ? (
            <div className="mt-4 rounded-2xl border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          <button
            onClick={() => void joinRoom()}
            disabled={isJoining}
            className="mt-5 w-full rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isJoining ? "Joining..." : "Join room"}
          </button>
        </div>
      ) : (
        <LiveKitRoom
          token={livekitToken ?? undefined}
          serverUrl={LIVEKIT_URL}
          connect={shouldConnectRoom}
          audio={false}
          video={false}
          data-lk-theme="default"
          className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[1.5fr_0.9fr]"
        >
          <section className="rounded-[28px] border border-zinc-800 bg-zinc-900/50 p-4 md:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-white">Live room</h2>
                <p className="text-sm text-zinc-400">{ROOM_NAME}</p>
              </div>

              <div className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/80 px-3 py-1 text-xs text-zinc-300">
                <span
                  className={`h-2 w-2 rounded-full ${
                    natsStatus === "connected"
                      ? "bg-emerald-400"
                      : natsStatus === "connecting"
                      ? "bg-amber-400"
                      : "bg-zinc-500"
                  }`}
                />
                NATS: {natsStatus}
              </div>
            </div>

            <ParticipantVideoGrid />
            <RoomControls onLeave={leaveRoom} />
            <RoomAudioRenderer />
          </section>

          <aside className="grid grid-cols-1 gap-6">
            <OnlineUsersPanel />

            <div className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-4">
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-zinc-100">Room chat</h2>
                <p className="text-xs text-zinc-400">
                  Published to NATS in realtime.
                </p>
              </div>

              <div className="mb-4 h-[320px] overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950/70 p-3">
                {messages.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                    No messages yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {messages.map((msg) => {
                      const isMine = msg.user === name.trim();

                      return (
                        <div
                          key={msg.id}
                          className={`flex ${isMine ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                              isMine
                                ? "bg-white text-zinc-950"
                                : "border border-zinc-800 bg-zinc-900 text-zinc-100"
                            }`}
                          >
                            <div
                              className={`mb-1 text-xs ${
                                isMine ? "text-zinc-700" : "text-zinc-400"
                              }`}
                            >
                              {msg.user} • {formatTime(msg.ts)}
                            </div>
                            <div className="text-sm leading-relaxed">{msg.text}</div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={chatEndRef} />
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-500"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      void sendMessage();
                    }
                  }}
                />
                <button
                  onClick={() => void sendMessage()}
                  className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200"
                >
                  Send
                </button>
              </div>

              {error ? (
                <div className="mt-4 rounded-2xl border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">
                  {error}
                </div>
              ) : null}
            </div>
          </aside>
        </LiveKitRoom>
      )}
    </div>
  );
}