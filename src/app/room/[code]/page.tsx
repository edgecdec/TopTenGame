"use client";
import { use, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Container,
  FormControl,
  IconButton,
  InputLabel,
  Link as MuiLink,
  MenuItem,
  Paper,
  Select,
  Slider,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ShareIcon from "@mui/icons-material/Share";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import { useSocket } from "@/hooks/useSocket";
import type { ClientRoomState, GameSettings } from "@/lib/types";

type Country = { code: string; name: string };
type ThemeInfo = { theme: string; count: number };

export default function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const search = useSearchParams();
  const router = useRouter();
  const urlName = search.get("name") || "";
  const [name, setName] = useState<string | null>(urlName || null);

  // If the URL has no name, try localStorage before falling back to the home page.
  // This lets returning users click an invite link and land straight in the room.
  useEffect(() => {
    if (name !== null) return;
    const saved = typeof window !== "undefined" ? localStorage.getItem("topten_name") : null;
    if (saved && saved.trim()) {
      setName(saved.trim());
    } else {
      router.replace(`/?joinCode=${code}`);
    }
  }, [name, code, router]);

  const { state, connected, emit, userId } = useSocket(code, name ?? "");
  const [countries, setCountries] = useState<Country[]>([]);
  const [themes, setThemes] = useState<ThemeInfo[]>([]);
  const [picks, setPicks] = useState<Country[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/data")
      .then((r) => r.json())
      .then((d) => {
        setCountries(d.countries);
        setThemes(d.themes);
      });
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (state?.phase !== "playing") setPicks([]);
  }, [state?.phase, state?.currentQuestionMeta?.id]);

  if (!name || !state) {
    return (
      <Container sx={{ py: 8 }}>
        <Typography>
          {!name ? "Redirecting..." : connected ? "Loading room..." : "Connecting..."}
        </Typography>
      </Container>
    );
  }

  const me = state.players.find((p) => p.id === userId);
  const isHost = me?.isHost ?? false;

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <RoomHeader state={state} onCopy={(msg) => setToast(msg)} />
      {state.phase === "lobby" && (
        <LobbyView
          state={state}
          themes={themes}
          isHost={isHost}
          onStart={() => emit("start_game")}
          onUpdateSettings={(partial) => emit("update_settings", partial)}
        />
      )}
      {state.phase === "playing" && (
        <PlayingView
          state={state}
          countries={countries}
          picks={picks}
          setPicks={(next) => {
            setPicks(next);
            emit("stage_picks", { picks: next.map((c) => c.code) });
          }}
          now={now}
          me={me}
          onSubmit={() => emit("submit_picks", { picks: picks.map((c) => c.code) })}
        />
      )}
      {state.phase === "intermission" && (
        <IntermissionView state={state} isHost={isHost} onNext={() => emit("next_question")} />
      )}
      {state.phase === "final_results" && (
        <FinalResultsView state={state} isHost={isHost} onLobby={() => emit("return_to_lobby")} />
      )}
      <Snackbar
        open={!!toast}
        autoHideDuration={2500}
        onClose={() => setToast(null)}
        message={toast}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Container>
  );
}

function RoomHeader({ state, onCopy }: { state: ClientRoomState; onCopy: (msg: string) => void }) {
  const copyCode = async () => {
    await navigator.clipboard.writeText(state.roomCode);
    onCopy("Room code copied");
  };
  const copyLink = async () => {
    const url = `${window.location.origin}/room/${state.roomCode}`;
    await navigator.clipboard.writeText(url);
    onCopy("Invite link copied");
  };
  const shareLink = async () => {
    const url = `${window.location.origin}/room/${state.roomCode}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Top Ten", text: `Join my Top Ten game — room ${state.roomCode}`, url });
      } catch {
        // user cancelled
      }
    } else {
      await navigator.clipboard.writeText(url);
      onCopy("Invite link copied");
    }
  };

  return (
    <Paper sx={{ p: { xs: 2, sm: 3 }, mb: 3 }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }} justifyContent="space-between">
        <Stack direction="row" alignItems="center" spacing={2}>
          <Box>
            <Typography variant="overline" color="text.secondary">
              Room code
            </Typography>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="h3" fontWeight={800} letterSpacing={6}>
                {state.roomCode}
              </Typography>
              <Tooltip title="Copy code">
                <IconButton size="small" onClick={copyCode}>
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          </Box>
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={copyLink}>
            Copy link
          </Button>
          <Button variant="contained" startIcon={<ShareIcon />} onClick={shareLink}>
            Share
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

function PlayerList({ state, showSubmitted }: { state: ClientRoomState; showSubmitted?: boolean }) {
  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom color="text.secondary">
        Players ({state.players.filter((p) => p.connected).length} online)
      </Typography>
      <Stack direction="row" flexWrap="wrap" gap={1}>
        {state.players.map((p) => {
          const label = (
            <Stack direction="row" alignItems="center" spacing={0.5}>
              {showSubmitted &&
                (p.submitted ? (
                  <CheckCircleIcon fontSize="small" color="success" />
                ) : (
                  <RadioButtonUncheckedIcon fontSize="small" color="disabled" />
                ))}
              <Typography variant="body2" component="span">
                {p.name}
                {p.isHost && " ★"}
                {state.phase !== "lobby" && ` — ${p.score}`}
              </Typography>
            </Stack>
          );
          return (
            <Chip
              key={p.id}
              label={label}
              color={p.connected ? "primary" : "default"}
              variant={p.connected ? "filled" : "outlined"}
            />
          );
        })}
      </Stack>
    </Box>
  );
}

function LobbyView({
  state,
  themes,
  isHost,
  onStart,
  onUpdateSettings,
}: {
  state: ClientRoomState;
  themes: ThemeInfo[];
  isHost: boolean;
  onStart: () => void;
  onUpdateSettings: (partial: Partial<GameSettings>) => void;
}) {
  const s = state.settings;
  const currentTheme = themes.find((t) => t.theme === s.theme);
  const maxQuestions = currentTheme?.count ?? 1;
  useEffect(() => {
    if (isHost && currentTheme && s.numQuestions > currentTheme.count) {
      onUpdateSettings({ numQuestions: currentTheme.count });
    }
  }, [isHost, currentTheme, s.numQuestions, onUpdateSettings]);

  return (
    <Stack spacing={3}>
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>
          Lobby
        </Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Share the room code or invite link with friends.{" "}
          {isHost ? "You're the host — set up the game and press Start when ready." : "Waiting for the host to start."}
        </Typography>
        <Box sx={{ mt: 3 }}>
          <PlayerList state={state} />
        </Box>
      </Paper>

      {isHost ? (
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Game settings
          </Typography>
          <Stack spacing={3} sx={{ mt: 2 }}>
            <FormControl fullWidth>
              <InputLabel>Theme</InputLabel>
              <Select
                label="Theme"
                value={themes.some((t) => t.theme === s.theme) ? s.theme : ""}
                onChange={(e) => onUpdateSettings({ theme: e.target.value })}
              >
                {themes.map((t) => (
                  <MenuItem key={t.theme} value={t.theme}>
                    {t.theme} ({t.count} question{t.count === 1 ? "" : "s"})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Box>
              <Typography gutterBottom>
                Number of questions: {s.numQuestions} <Typography component="span" variant="caption" color="text.secondary">(max {maxQuestions})</Typography>
              </Typography>
              <Slider
                value={Math.min(s.numQuestions, maxQuestions)}
                min={1}
                max={Math.max(1, maxQuestions)}
                step={1}
                marks={maxQuestions <= 20}
                valueLabelDisplay="auto"
                onChange={(_, v) => onUpdateSettings({ numQuestions: v as number })}
              />
            </Box>

            <Box>
              <Typography gutterBottom>Answers per player per question: {s.picksPerPlayer}</Typography>
              <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                1 = Kahoot-style (one guess), up to Top N = full top-list mode
              </Typography>
              <Slider
                value={Math.min(s.picksPerPlayer, s.topN)}
                min={1}
                max={s.topN}
                step={1}
                marks={s.topN <= 20}
                valueLabelDisplay="auto"
                onChange={(_, v) => onUpdateSettings({ picksPerPlayer: v as number })}
              />
            </Box>

            <Box>
              <Typography gutterBottom>Answers considered correct (Top N): {s.topN}</Typography>
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

            <FormControl fullWidth>
              <InputLabel>Scoring mode</InputLabel>
              <Select
                label="Scoring mode"
                value={s.scoringMode}
                onChange={(e) => onUpdateSettings({ scoringMode: e.target.value as GameSettings["scoringMode"] })}
              >
                <MenuItem value="rank">Rank — rank N = N pts (harder to guess = worth more)</MenuItem>
                <MenuItem value="inverse">Inverse — #1 = topN pts, #topN = 1 pt</MenuItem>
                <MenuItem value="flat">Flat — 1 pt per correct answer</MenuItem>
              </Select>
            </FormControl>

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

            <Button variant="contained" size="large" onClick={onStart} disabled={!themes.length}>
              Start game
            </Button>
          </Stack>
        </Paper>
      ) : (
        <Paper sx={{ p: 3 }}>
          <Typography variant="subtitle2" gutterBottom>
            Game settings
          </Typography>
          <Typography variant="body2">Theme: <strong>{s.theme}</strong></Typography>
          <Typography variant="body2">Questions: <strong>{s.numQuestions}</strong></Typography>
          <Typography variant="body2">Picks per player: <strong>{s.picksPerPlayer}</strong></Typography>
          <Typography variant="body2">Top N considered correct: <strong>{s.topN}</strong></Typography>
          <Typography variant="body2">Scoring: <strong>{s.scoringMode}</strong></Typography>
          <Typography variant="body2">Timer: <strong>{s.roundDurationSec}s</strong></Typography>
        </Paper>
      )}
    </Stack>
  );
}

function PlayingView({
  state,
  countries,
  picks,
  setPicks,
  now,
  me,
  onSubmit,
}: {
  state: ClientRoomState;
  countries: Country[];
  picks: Country[];
  setPicks: (v: Country[]) => void;
  now: number;
  me: ClientRoomState["players"][number] | undefined;
  onSubmit: () => void;
}) {
  const meta = state.currentQuestionMeta;
  if (!meta) return null;
  const secondsLeft = state.endsAt ? Math.max(0, Math.ceil((state.endsAt - now) / 1000)) : 0;
  const optionsSorted = useMemo(() => [...countries].sort((a, b) => a.name.localeCompare(b.name)), [countries]);
  const submitted = me?.submitted ?? false;

  return (
    <Stack spacing={3}>
      <Paper sx={{ p: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems={{ sm: "center" }} flexWrap="wrap" gap={2}>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Question {state.currentQuestionIdx + 1} of {state.totalQuestions}
            </Typography>
            <Typography variant="h5" fontWeight={700}>
              {meta.title}
            </Typography>
          </Box>
          <Typography variant="h3" fontWeight={800} color={secondsLeft <= 10 ? "error" : "primary"}>
            {secondsLeft}s
          </Typography>
        </Stack>
        <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
          {meta.prompt} Pick {meta.picksPerPlayer === 1 ? "one country" : `up to ${meta.picksPerPlayer} countries`} from the top {meta.topN}.
        </Typography>
        <Autocomplete
          multiple={meta.picksPerPlayer > 1}
          options={optionsSorted}
          value={meta.picksPerPlayer > 1 ? picks : picks[0] ?? null}
          onChange={(_, v) => {
            if (meta.picksPerPlayer === 1) {
              setPicks(v ? [v as Country] : []);
            } else {
              setPicks((v as Country[]).slice(0, meta.picksPerPlayer));
            }
          }}
          getOptionLabel={(o) => (o as Country).name}
          isOptionEqualToValue={(a, b) => (a as Country).code === (b as Country).code}
          filterSelectedOptions
          disabled={submitted}
          sx={{ mt: 3 }}
          renderInput={(params) => (
            <TextField
              {...params}
              label={
                meta.picksPerPlayer === 1
                  ? "Your pick"
                  : `Your picks (${picks.length}/${meta.picksPerPlayer})`
              }
              placeholder="Type to search..."
            />
          )}
        />
        <Stack direction="row" spacing={2} sx={{ mt: 3 }} alignItems="center">
          <Button variant="contained" size="large" onClick={onSubmit} disabled={picks.length === 0 || submitted}>
            {submitted ? "Locked in" : "Lock in"}
          </Button>
          <Typography variant="body2" color="text.secondary">
            {submitted
              ? "Waiting for other players..."
              : "Your current picks will count when the timer ends. Lock in to skip ahead if everyone else has too."}
          </Typography>
        </Stack>
      </Paper>
      <Paper sx={{ p: 3 }}>
        <PlayerList state={state} showSubmitted />
      </Paper>
    </Stack>
  );
}

function IntermissionView({
  state,
  isHost,
  onNext,
}: {
  state: ClientRoomState;
  isHost: boolean;
  onNext: () => void;
}) {
  const r = state.lastResults;
  if (!r) return null;
  const codeToName = new Map(state.players.map((p) => [p.id, p.name]));
  const scoreboard = [...state.players].sort((a, b) => b.score - a.score);
  const isLast = state.currentQuestionIdx + 1 >= state.totalQuestions;

  return (
    <Stack spacing={3}>
      <Paper sx={{ p: 3 }}>
        <Typography variant="caption" color="text.secondary">
          Question {state.currentQuestionIdx + 1} of {state.totalQuestions} — Results
        </Typography>
        <Typography variant="h5" fontWeight={700} gutterBottom>
          {r.questionTitle}
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
          Player picks this round
        </Typography>
        <Stack spacing={2}>
          {state.players.map((p) => {
            const details = r.perPlayer[p.id];
            if (!details) return null;
            return (
              <Box key={p.id}>
                <Typography fontWeight={700}>
                  {p.name} — {details.roundScore >= 0 ? "+" : ""}
                  {details.roundScore} this round
                </Typography>
                <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 1 }}>
                  {details.picksScored.length === 0 && (
                    <Chip label="(no pick)" variant="outlined" size="small" />
                  )}
                  {details.picksScored.map((ps, i) => (
                    <Chip
                      key={i}
                      label={ps.rank ? `${ps.label} #${ps.rank} (+${ps.points})` : `${ps.label} (miss${ps.points !== 0 ? ` ${ps.points}` : ""})`}
                      color={ps.rank ? "success" : "default"}
                      variant={ps.rank ? "filled" : "outlined"}
                      size="small"
                    />
                  ))}
                </Stack>
              </Box>
            );
          })}
        </Stack>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>
          Scoreboard
        </Typography>
        <Stack spacing={1}>
          {scoreboard.map((p, i) => (
            <Stack key={p.id} direction="row" alignItems="center" spacing={2}>
              <Typography sx={{ width: 24, fontWeight: 700 }} color="text.secondary">
                #{i + 1}
              </Typography>
              <Typography sx={{ flex: 1 }} fontWeight={i === 0 ? 700 : 400}>
                {p.name}
              </Typography>
              <Typography fontWeight={700}>{p.score}</Typography>
            </Stack>
          ))}
        </Stack>
      </Paper>

      {isHost ? (
        <Button variant="contained" size="large" onClick={onNext}>
          {isLast ? "See final results" : "Next question"}
        </Button>
      ) : (
        <Typography variant="body2" color="text.secondary" textAlign="center">
          Waiting for host to continue...
        </Typography>
      )}
    </Stack>
  );
}

function FinalResultsView({
  state,
  isHost,
  onLobby,
}: {
  state: ClientRoomState;
  isHost: boolean;
  onLobby: () => void;
}) {
  const scoreboard = state.finalScoreboard ?? [];
  return (
    <Stack spacing={3}>
      <Paper sx={{ p: 3 }}>
        <Typography variant="overline" color="text.secondary">
          Game complete
        </Typography>
        <Typography variant="h4" fontWeight={800} gutterBottom>
          Final scoreboard
        </Typography>
        <Stack spacing={1.5} sx={{ mt: 2 }}>
          {scoreboard.map((entry, i) => (
            <Stack key={entry.playerId} direction="row" alignItems="center" spacing={2}>
              <Typography sx={{ width: 40, fontWeight: 800 }} variant="h5" color={i === 0 ? "warning.main" : "text.secondary"}>
                {i === 0 ? "🏆" : `#${i + 1}`}
              </Typography>
              <Typography sx={{ flex: 1 }} fontWeight={i === 0 ? 800 : 500} variant={i === 0 ? "h5" : "body1"}>
                {entry.name}
              </Typography>
              <Typography fontWeight={800} variant={i === 0 ? "h5" : "body1"}>
                {entry.score}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </Paper>
      {isHost ? (
        <Button variant="contained" size="large" onClick={onLobby}>
          Back to lobby (new game)
        </Button>
      ) : (
        <Typography variant="body2" color="text.secondary" textAlign="center">
          Waiting for host to start a new game...
        </Typography>
      )}
    </Stack>
  );
}
