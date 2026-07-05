"use client";
import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import type { ClientRoomState } from "@/lib/types";

const SESSION_COOKIE = "topten_session";

export function useSocket(roomCode: string, name: string) {
  const [state, setState] = useState<ClientRoomState | null>(null);
  const [userId, setUserId] = useState<string>("");
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!roomCode || !name) return;

    const s = io({
      // Send cookies with the handshake so the server can verify identity.
      transports: ["websocket", "polling"],
      withCredentials: true,
    });
    socketRef.current = s;

    s.on("connect", () => {
      setConnected(true);
      s.emit("join_room", { roomCode, name });
    });
    s.on("disconnect", () => setConnected(false));
    s.on("identity", (payload: { userId: string; sessionToken: string }) => {
      if (payload?.userId) setUserId(payload.userId);
      if (payload?.sessionToken) {
        document.cookie = `${SESSION_COOKIE}=${payload.sessionToken}; path=/; max-age=31536000; SameSite=Lax`;
      }
    });
    s.on("state_update", (next: ClientRoomState | null) => {
      if (next) setState(next);
    });
    s.on("error_message", (msg: string) => {
      console.warn("Server error:", msg);
    });

    return () => {
      s.disconnect();
    };
  }, [roomCode, name]);

  const emit = <T,>(event: string, payload?: T) => socketRef.current?.emit(event, payload);

  return { state, connected, emit, userId };
}
