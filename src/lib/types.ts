export type ScoringMode = "rank" | "inverse" | "flat";

export type GameSettings = {
  theme: string;
  subtheme: string; // "*" means all subthemes
  numQuestions: number;
  scoringMode: ScoringMode;
  topN: number;
  picksPerPlayer: number;
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
  questionTitle: string;
  correctAnswers: Array<{ rank: number; code: string; value: string; label: string }>;
  perPlayer: Record<
    string,
    {
      picks: string[];
      roundScore: number;
      picksScored: Array<{ code: string; label: string; rank: number | null; points: number }>;
    }
  >;
  source: { name: string; url: string; asOf: string };
  note: string | null;
  disclaimer: string | null;
  trivia: string | null;
  asOfDate: string | null;
};

export type FinalScoreboardEntry = { playerId: string; name: string; score: number };

export type RoomPhase = "lobby" | "playing" | "intermission" | "final_results";

export type ClientRoomState = {
  roomCode: string;
  phase: RoomPhase;
  settings: GameSettings;
  players: PlayerPublic[];
  currentQuestionIdx: number;
  totalQuestions: number;
  currentQuestionMeta: {
    id: string;
    title: string;
    prompt: string;
    topN: number;
    picksPerPlayer: number;
    answerType: string;
    codeFilter: string | null;
    disclaimer: string | null;
    asOfDate: string | null;
  } | null;
  endsAt: number | null;
  lastResults: RoundResults | null;
  finalScoreboard: FinalScoreboardEntry[] | null;
};

export type ThemeInfo = { theme: string; count: number };
