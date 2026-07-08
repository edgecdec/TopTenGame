"use client";
import {
  Alert,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Box,
  Button,
  Container,
  Paper,
  Stack,
  Typography,
  Chip,
  Divider,
  Link as MuiLink,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
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

type Round = {
  idx: number;
  questionId: string;
  questionTitle: string;
  answerType: string;
  yourPick: { code: string; label: string } | null;
  yourRank: number | null;
  yourFullRank: number | null;
  totalRanked: number;
  pointsEarned: number;
  topN: number;
  correctAnswers: Array<{ rank: number; code: string; value: string; label: string }>;
  source: { name: string; url: string; asOf: string };
  disclaimer: string | null;
  trivia: string | null;
  asOfDate: string | null;
};

export default function ResultsPage({ params }: { params: Promise<{ sid: string }> }) {
  const { sid } = use(params);
  const router = useRouter();
  const [state, setState] = useState<SoloState | null>(null);
  const [board, setBoard] = useState<BoardResp | null>(null);
  const [rounds, setRounds] = useState<Round[]>([]);

  useEffect(() => {
    fetch(`/api/solo/${sid}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((s: SoloState) => {
        setState(s);
        return Promise.all([
          fetch(`/api/leaderboard?mode=${s.mode}&theme=${encodeURIComponent(s.theme)}`).then((r) => r.json()),
          fetch(`/api/solo/${sid}/rounds`).then((r) => r.json()),
        ]);
      })
      .then(([b, r]: [BoardResp, { rounds: Round[] }]) => {
        setBoard(b);
        setRounds(r.rounds || []);
      })
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
        <Stack direction="row" spacing={2} justifyContent="center" flexWrap="wrap">
          <Button
            variant="contained"
            onClick={() => {
              const p = new URLSearchParams({
                name: state.displayName,
                mode: state.mode,
                theme: state.theme,
                auto: "1",
              });
              router.push(`/solo?${p.toString()}`);
            }}
          >
            Play again
          </Button>
          <Button
            variant="outlined"
            onClick={() => {
              const p = new URLSearchParams({
                name: state.displayName,
                mode: state.mode,
                theme: state.theme,
              });
              router.push(`/solo?${p.toString()}`);
            }}
          >
            Change settings
          </Button>
          <Button variant="outlined" onClick={() => router.push(`/leaderboard?mode=${state.mode}&theme=${encodeURIComponent(state.theme)}`)}>
            Full leaderboard
          </Button>
        </Stack>

        {rounds.length > 0 && (
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>Round-by-round</Typography>
            <Divider sx={{ mb: 1 }} />
            <Stack spacing={1}>
              {rounds.map((r) => (
                <Accordion key={r.idx} disableGutters sx={{ bgcolor: "transparent" }}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ width: "100%" }}>
                      <Typography sx={{ width: 32, color: "text.secondary" }}>Q{r.idx + 1}</Typography>
                      <Typography sx={{ flex: 1, fontWeight: 500 }}>{r.questionTitle}</Typography>
                      {r.yourRank !== null ? (
                        <Chip size="small" color="success" label={`#${r.yourRank} · +${r.pointsEarned}`} />
                      ) : r.yourFullRank !== null ? (
                        <Chip size="small" label={`#${r.yourFullRank}${r.pointsEarned !== 0 ? ` · ${r.pointsEarned}` : ""}`} />
                      ) : r.yourPick ? (
                        <Chip size="small" label={`N/A${r.pointsEarned !== 0 ? ` · ${r.pointsEarned}` : ""}`} />
                      ) : (
                        <Chip size="small" variant="outlined" label="no pick" />
                      )}
                    </Stack>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Stack spacing={1.5}>
                      <Typography variant="body2" color="text.secondary">
                        Your pick:{" "}
                        {r.yourPick ? (
                          <>
                            <b>{r.yourPick.label}</b>{" "}
                            {r.yourRank !== null
                              ? `— #${r.yourRank}, +${r.pointsEarned}`
                              : r.yourFullRank !== null
                                ? `— ranked #${r.yourFullRank} of ${r.totalRanked} (outside top ${r.topN})`
                                : `— wasn't in the top ${r.totalRanked}`}
                          </>
                        ) : (
                          "no pick this round"
                        )}
                      </Typography>
                      <Box>
                        <Typography variant="subtitle2" gutterBottom>Correct top {r.correctAnswers.length}</Typography>
                        <Stack spacing={0.5}>
                          {r.correctAnswers.map((a) => {
                            const yours = r.yourPick && a.code === r.yourPick.code;
                            return (
                              <Stack key={a.code} direction="row" spacing={1}>
                                <Typography sx={{ width: 32, fontWeight: 700, color: yours ? "success.main" : undefined }}>
                                  #{a.rank}
                                </Typography>
                                <Typography sx={{ flex: 1, fontWeight: yours ? 700 : 400 }}>{a.label}</Typography>
                                <Typography color="text.secondary">{a.value}</Typography>
                              </Stack>
                            );
                          })}
                        </Stack>
                      </Box>
                      {r.disclaimer && (
                        <Alert severity="info" icon={false}>{r.disclaimer}</Alert>
                      )}
                      {r.trivia && (
                        <Alert severity="warning" icon={false} sx={{ backgroundColor: "rgba(124,92,255,0.12)", color: "inherit" }}>
                          {r.trivia}
                        </Alert>
                      )}
                      <Typography variant="caption" color="text.secondary">
                        Source:{" "}
                        {r.source.url ? (
                          <MuiLink href={r.source.url} target="_blank" rel="noreferrer">{r.source.name}</MuiLink>
                        ) : (
                          r.source.name
                        )}
                        {r.source.asOf ? ` · ${r.source.asOf}` : ""}
                      </Typography>
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              ))}
            </Stack>
          </Paper>
        )}

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
