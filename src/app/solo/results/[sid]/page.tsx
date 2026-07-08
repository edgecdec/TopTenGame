"use client";
import { Box, Button, Container, Paper, Stack, Typography, Chip, Divider } from "@mui/material";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type LeaderboardEntry = { rank: number; displayName: string; score: number; isYou: boolean; createdAt: number };
type BoardResp = {
  mode: string;
  theme: string;
  entries: LeaderboardEntry[];
  best: { score: number; rank: number | null } | null;
};

type SoloState = {
  sessionId: string;
  mode: string;
  theme: string;
  displayName: string;
  score: number;
  totalQuestions: number;
  finished: boolean;
};

export default function ResultsPage({ params }: { params: Promise<{ sid: string }> }) {
  const { sid } = use(params);
  const router = useRouter();
  const [state, setState] = useState<SoloState | null>(null);
  const [board, setBoard] = useState<BoardResp | null>(null);

  useEffect(() => {
    fetch(`/api/solo/${sid}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((s: SoloState) => {
        setState(s);
        return fetch(`/api/leaderboard?mode=${s.mode}&theme=${encodeURIComponent(s.theme)}`).then((r) => r.json());
      })
      .then((b: BoardResp) => setBoard(b))
      .catch(() => {});
  }, [sid]);

  if (!state) {
    return <Container maxWidth="sm" sx={{ py: 6 }}><Typography>Loading…</Typography></Container>;
  }

  const themeLabel = state.theme === "*" ? "All categories" : state.theme;

  return (
    <Container maxWidth="sm" sx={{ py: 6 }}>
      <Stack spacing={3}>
        <Box textAlign="center">
          <Typography variant="overline" color="text.secondary">Final score · {themeLabel} · {state.mode}</Typography>
          <Typography variant="h1" fontWeight={800}>{state.score}</Typography>
          <Typography variant="body2" color="text.secondary">
            {state.displayName} · {state.totalQuestions} questions
          </Typography>
        </Box>
        <Stack direction="row" spacing={2} justifyContent="center">
          <Button variant="contained" onClick={() => router.push(`/solo?name=${encodeURIComponent(state.displayName)}`)}>
            Play again
          </Button>
          <Button variant="outlined" onClick={() => router.push(`/leaderboard?mode=${state.mode}&theme=${encodeURIComponent(state.theme)}`)}>
            Full leaderboard
          </Button>
        </Stack>
        {board && (
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>Top 25 · {themeLabel} · {state.mode}</Typography>
            {board.best && (
              <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                Your best: {board.best.score}
                {board.best.rank !== null ? ` (rank #${board.best.rank})` : ""}
              </Typography>
            )}
            <Divider sx={{ my: 1 }} />
            <Stack spacing={0.5}>
              {board.entries.length === 0 && (
                <Typography color="text.secondary" variant="body2">No scores yet.</Typography>
              )}
              {board.entries.map((e) => (
                <Stack key={e.rank} direction="row" alignItems="center" spacing={1} sx={{ fontWeight: e.isYou ? 700 : 400 }}>
                  <Typography sx={{ width: 30, textAlign: "right" }}>#{e.rank}</Typography>
                  <Typography sx={{ flex: 1 }}>{e.displayName}</Typography>
                  <Typography>{e.score}</Typography>
                  {e.isYou && <Chip label="you" size="small" color="primary" />}
                </Stack>
              ))}
            </Stack>
          </Paper>
        )}
        <Button size="small" onClick={() => router.push("/")}>← Home</Button>
      </Stack>
    </Container>
  );
}
