export type ScoringMode = "rank" | "inverse" | "flat";

export type GameSettings = {
  scoringMode: ScoringMode;
  topN: number;
  missPenalty: number;
  roundDurationSec: number;
};

export type PlayerPublic = {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  score: number;
  submitted: boolean;
};

export type RoundResults = {
  correctAnswers: Array<{ rank: number; code: string; value: string; label: string }>;
  perPlayer: Record<string, { picks: string[]; roundScore: number; picksScored: Array<{ code: string; label: string; rank: number | null; points: number }> }>;
  source: { name: string; url: string; asOf: string };
  note: string | null;
  questionTitle: string;
};

export type RoomPhase = "lobby" | "playing" | "results";

export type ClientRoomState = {
  roomCode: string;
  phase: RoomPhase;
  settings: GameSettings;
  players: PlayerPublic[];
  currentQuestionId: string | null;
  currentQuestionMeta: {
    id: string;
    title: string;
    prompt: string;
    topN: number;
    note: string | null;
  } | null;
  endsAt: number | null;
  lastResults: RoundResults | null;
};

export type ServerToClientEvents = {
  state_update: (state: ClientRoomState) => void;
  round_started: (payload: { questionId: string; title: string; prompt: string; topN: number; endsAt: number; note: string | null }) => void;
  round_results: (results: RoundResults) => void;
  error_message: (msg: string) => void;
};

export type ClientToServerEvents = {
  join_room: (payload: { roomCode: string; name: string }) => void;
  set_name: (payload: { name: string }) => void;
  update_settings: (settings: Partial<GameSettings>) => void;
  start_round: (payload: { questionId: string }) => void;
  submit_picks: (payload: { picks: string[] }) => void;
  return_to_lobby: () => void;
};
