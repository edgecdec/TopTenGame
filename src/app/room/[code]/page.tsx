"use client";
import { use, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Box,
  Button,
  Chip,
  Container,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  TextField,
  Typography,
  Autocomplete,
  Alert,
  Link as MuiLink,
} from "@mui/material";
import { useSocket } from "@/hooks/useSocket";
import type { ClientRoomState } from "@/lib/types";

type Country = { code: string; name: string };
type QuestionMeta = {
  id: string;
  theme: string;
  title: string;
  prompt: string;
  answerType: string;
  seededDepth: number;
  source: { name: string; url: string; asOf: string };
  note: string | null;
};

export default function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const search = useSearchParams();
  const router = useRouter();
  const name = search.get("name") || "";

  useEffect(() => {
    if (!name) router.replace("/");
  }, [name, router]);

  const { state, connected, emit } = useSocket(code, name);
  const [countries, setCountries] = useState<Country[]>([]);
  const [questions, setQuestions] = useState<QuestionMeta[]>([]);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string>("");
  const [picks, setPicks] = useState<Country[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    fetch("/api/data")
      .then((r) => r.json())
      .then((d) => {
        setCountries(d.countries);
        setQuestions(d.questions);
        if (d.questions.length && !selectedQuestionId) setSelectedQuestionId(d.questions[0].id);
      });
  }, [selectedQuestionId]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (state?.phase !== "playing") setPicks([]);
  }, [state?.phase, state?.currentQuestionId]);

  if (!name || !state) {
    return (
      <Container sx={{ py: 8 }}>
        <Typography>{connected ? "Loading room..." : "Connecting..."}</Typography>
      </Container>
    );
  }

  const me = state.players.find((p) => p.name === name); // fallback identity match; server keys by userId cookie
  const isHost = state.players[0]?.isHost && state.players.find((p) => p.isHost && p.name === name);

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <RoomHeader state={state} />
      {state.phase === "lobby" && (
        <LobbyView
          state={state}
          questions={questions}
          isHost={!!isHost}
          selectedQuestionId={selectedQuestionId}
          setSelectedQuestionId={setSelectedQuestionId}
          onStart={() => emit("start_round", { questionId: selectedQuestionId })}
          onUpdateSettings={(partial) => emit("update_settings", partial)}
        />
      )}
      {state.phase === "playing" && (
        <PlayingView
          state={state}
          countries={countries}
          picks={picks}
          setPicks={setPicks}
          now={now}
          onSubmit={() => emit("submit_picks", { picks: picks.map((c) => c.code) })}
        />
      )}
      {state.phase === "results" && (
        <ResultsView
          state={state}
          countries={countries}
          isHost={!!isHost}
          onNext={() => emit("return_to_lobby")}
        />
      )}
    </Container>
  );
}

function RoomHeader({ state }: { state: ClientRoomState }) {
  return (
    <Stack direction={{ xs: "column", sm: "row" }} alignItems={{ sm: "center" }} justifyContent="space-between" sx={{ mb: 3 }}>
      <Box>
        <Typography variant="overline" color="text.secondary">
          Room code
        </Typography>
        <Typography variant="h3" fontWeight={800} letterSpacing={6}>
          {state.roomCode}
        </Typography>
      </Box>
      <Stack direction="row" spacing={1} flexWrap="wrap">
        {state.players.map((p) => (
          <Chip
            key={p.id}
            label={`${p.name}${p.isHost ? " ★" : ""} — ${p.score}`}
            color={p.connected ? "primary" : "default"}
            variant={p.submitted && state.phase === "playing" ? "filled" : "outlined"}
          />
        ))}
      </Stack>
    </Stack>
  );
}

function LobbyView({
  state,
  questions,
  isHost,
  selectedQuestionId,
  setSelectedQuestionId,
  onStart,
  onUpdateSettings,
}: {
  state: ClientRoomState;
  questions: QuestionMeta[];
  isHost: boolean;
  selectedQuestionId: string;
  setSelectedQuestionId: (id: string) => void;
  onStart: () => void;
  onUpdateSettings: (partial: Partial<ClientRoomState["settings"]>) => void;
}) {
  const s = state.settings;
  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>
        Lobby
      </Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Share the room code with friends. {isHost ? "You're the host — pick a question and settings to start." : "Waiting for the host to start the round."}
      </Typography>

      {isHost ? (
        <Stack spacing={3} sx={{ mt: 3 }}>
          <FormControl fullWidth>
            <InputLabel>Question</InputLabel>
            <Select label="Question" value={selectedQuestionId} onChange={(e) => setSelectedQuestionId(e.target.value)}>
              {questions.map((q) => (
                <MenuItem key={q.id} value={q.id}>
                  {q.title}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth>
            <InputLabel>Scoring mode</InputLabel>
            <Select
              label="Scoring mode"
              value={s.scoringMode}
              onChange={(e) => onUpdateSettings({ scoringMode: e.target.value as "rank" | "inverse" | "flat" })}
            >
              <MenuItem value="rank">Rank — #10 = 10 pts, #1 = 1 pt (harder to guess = worth more)</MenuItem>
              <MenuItem value="inverse">Inverse — #1 = 10 pts, #10 = 1 pt</MenuItem>
              <MenuItem value="flat">Flat — 1 pt per correct answer</MenuItem>
            </Select>
          </FormControl>

          <Box>
            <Typography gutterBottom>Top N: {s.topN}</Typography>
            <Slider
              value={s.topN}
              min={3}
              max={20}
              step={1}
              marks
              valueLabelDisplay="auto"
              onChange={(_, v) => onUpdateSettings({ topN: v as number })}
            />
          </Box>

          <Box>
            <Typography gutterBottom>Miss penalty: {s.missPenalty} pts per wrong pick</Typography>
            <Slider
              value={s.missPenalty}
              min={0}
              max={10}
              step={1}
              marks
              valueLabelDisplay="auto"
              onChange={(_, v) => onUpdateSettings({ missPenalty: v as number })}
            />
          </Box>

          <Box>
            <Typography gutterBottom>Round timer: {s.roundDurationSec}s</Typography>
            <Slider
              value={s.roundDurationSec}
              min={15}
              max={300}
              step={15}
              valueLabelDisplay="auto"
              onChange={(_, v) => onUpdateSettings({ roundDurationSec: v as number })}
            />
          </Box>

          <Button variant="contained" size="large" onClick={onStart} disabled={!selectedQuestionId}>
            Start Round
          </Button>
        </Stack>
      ) : (
        <Stack spacing={1} sx={{ mt: 3 }}>
          <SettingsSummary settings={s} />
        </Stack>
      )}
    </Paper>
  );
}

function SettingsSummary({ settings }: { settings: ClientRoomState["settings"] }) {
  return (
    <Box>
      <Typography variant="body2">
        <strong>Scoring:</strong> {settings.scoringMode}
      </Typography>
      <Typography variant="body2">
        <strong>Top:</strong> {settings.topN}
      </Typography>
      <Typography variant="body2">
        <strong>Miss penalty:</strong> {settings.missPenalty}
      </Typography>
      <Typography variant="body2">
        <strong>Timer:</strong> {settings.roundDurationSec}s
      </Typography>
    </Box>
  );
}

function PlayingView({
  state,
  countries,
  picks,
  setPicks,
  now,
  onSubmit,
}: {
  state: ClientRoomState;
  countries: Country[];
  picks: Country[];
  setPicks: (v: Country[]) => void;
  now: number;
  onSubmit: () => void;
}) {
  const meta = state.currentQuestionMeta;
  if (!meta) return null;
  const secondsLeft = state.endsAt ? Math.max(0, Math.ceil((state.endsAt - now) / 1000)) : 0;
  const me = state.players.find((p) => p.submitted);
  const submitted = false; // per-user submitted status derived by looking at players list matched to my cookie identity — kept simple visually via the chip filled state
  const optionsSorted = useMemo(() => [...countries].sort((a, b) => a.name.localeCompare(b.name)), [countries]);

  return (
    <Paper sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5" fontWeight={700}>
          {meta.title}
        </Typography>
        <Typography variant="h4" fontWeight={800} color={secondsLeft <= 10 ? "error" : "primary"}>
          {secondsLeft}s
        </Typography>
      </Stack>
      <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
        {meta.prompt} Pick up to <strong>{meta.topN}</strong>.
      </Typography>
      {meta.note && (
        <Alert severity="info" sx={{ mt: 2 }}>
          {meta.note}
        </Alert>
      )}
      <Autocomplete
        multiple
        options={optionsSorted}
        value={picks}
        onChange={(_, v) => setPicks(v.slice(0, meta.topN))}
        getOptionLabel={(o) => o.name}
        isOptionEqualToValue={(a, b) => a.code === b.code}
        filterSelectedOptions
        sx={{ mt: 3 }}
        renderInput={(params) => <TextField {...params} label={`Your picks (${picks.length}/${meta.topN})`} placeholder="Type to search..." />}
      />
      <Stack direction="row" spacing={2} sx={{ mt: 3 }} alignItems="center">
        <Button variant="contained" size="large" onClick={onSubmit} disabled={picks.length === 0 || submitted}>
          Lock in {picks.length > 0 && `(${picks.length})`}
        </Button>
        <Typography variant="body2" color="text.secondary">
          You can change picks and lock in again until the timer ends. When everyone has locked in, the round ends early.
        </Typography>
      </Stack>
    </Paper>
  );
}

function ResultsView({
  state,
  countries,
  isHost,
  onNext,
}: {
  state: ClientRoomState;
  countries: Country[];
  isHost: boolean;
  onNext: () => void;
}) {
  const r = state.lastResults;
  if (!r) return null;
  const codeToName = new Map(countries.map((c) => [c.code, c.name]));
  return (
    <Stack spacing={3}>
      <Paper sx={{ p: 3 }}>
        <Typography variant="h5" fontWeight={700} gutterBottom>
          {r.questionTitle} — Results
        </Typography>
        <Alert severity="success" sx={{ mb: 2 }}>
          Source: <strong>{r.source.name}</strong> ({r.source.asOf}) —{" "}
          <MuiLink href={r.source.url} target="_blank" rel="noreferrer">
            view
          </MuiLink>
        </Alert>
        {r.note && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {r.note}
          </Alert>
        )}
        <Typography variant="h6" gutterBottom>
          Correct answers
        </Typography>
        <Stack spacing={0.5}>
          {r.correctAnswers.map((a) => (
            <Stack key={a.rank} direction="row" spacing={2}>
              <Typography sx={{ width: 32, fontWeight: 700 }}>#{a.rank}</Typography>
              <Typography sx={{ flex: 1 }}>{a.label}</Typography>
              <Typography color="text.secondary">{a.value}</Typography>
            </Stack>
          ))}
        </Stack>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>
          Player scores
        </Typography>
        <Stack spacing={2}>
          {state.players.map((p) => {
            const details = r.perPlayer[p.id];
            if (!details) return null;
            return (
              <Box key={p.id}>
                <Stack direction="row" justifyContent="space-between">
                  <Typography fontWeight={700}>
                    {p.name} — {details.roundScore >= 0 ? "+" : ""}
                    {details.roundScore} this round (total {p.score})
                  </Typography>
                </Stack>
                <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 1 }}>
                  {details.picksScored.map((ps, i) => (
                    <Chip
                      key={i}
                      label={
                        ps.rank
                          ? `${codeToName.get(ps.code) || ps.code} #${ps.rank} (+${ps.points})`
                          : `${codeToName.get(ps.code) || ps.code} (miss${ps.points !== 0 ? ` ${ps.points}` : ""})`
                      }
                      color={ps.rank ? "success" : "default"}
                      variant={ps.rank ? "filled" : "outlined"}
                    />
                  ))}
                </Stack>
              </Box>
            );
          })}
        </Stack>
      </Paper>

      {isHost && (
        <Button variant="contained" size="large" onClick={onNext}>
          Back to lobby (next round)
        </Button>
      )}
      {!isHost && (
        <Typography variant="body2" color="text.secondary" textAlign="center">
          Waiting for host to start the next round...
        </Typography>
      )}
    </Stack>
  );
}
