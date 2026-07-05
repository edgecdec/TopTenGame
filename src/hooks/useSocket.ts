"use client";
import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import type { ClientRoomState, RoundResults } from "@/lib/types";

export function useSocket(roomCode: string, name: string) {
  const [state, setState] = useState<ClientRoomState | null>(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!roomCode || !name) return;
    const s = io({ transports: ["websocket", "polling"] });
    socketRef.current = s;

    s.on("connect", () => {
      setConnected(true);
      s.emit("join_room", { roomCode, name });
    });
    s.on("disconnect", () => setConnected(false));
    s.on("state_update", (next: ClientRoomState | null) => {
      if (next) setState(next);
    });
    s.on("round_results", (r: RoundResults) => {
      // state_update also fires with results in it; noop here but useful hook
      void r;
    });
    s.on("error_message", (msg: string) => {
      console.warn("Server error:", msg);
    });

    return () => {
      s.disconnect();
    };
  }, [roomCode, name]);

  const emit = <T,>(event: string, payload?: T) => socketRef.current?.emit(event, payload);

  return { state, connected, emit };
}
