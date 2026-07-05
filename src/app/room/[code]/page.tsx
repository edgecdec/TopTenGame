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
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import StarIcon from "@mui/icons-material/Star";
import { useSocket } from "@/hooks/useSocket";
import type { ClientRoomState, GameSettings, FinalScoreboardEntry } from "@/lib/types";

type Option = { code: string; name: string };
type SubthemeInfo = { subtheme: string; count: number };
type ThemeInfo = { theme: string; count: number; subthemes: SubthemeInfo[] };

function itemLabelForType(answerType: string): { singular: string; plural: string } {
  switch (answerType) {
    case "Countries": return { singular: "country", plural: "countries" };
    case "US States": return { singular: "state", plural: "states" };
    case "Pro Sports Teams": return { singular: "team", plural: "teams" };
    case "Companies": return { singular: "company", plural: "companies" };
    case "Chemical Elements": return { singular: "element", plural: "elements" };
    case "Movies": return { singular: "film", plural: "films" };
    default: return { singular: "answer", plural: "answers" };
  }
}

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

  const { state, connected, emit, userId, restoredPicks, consumeRestoredPicks } = useSocket(code, name ?? "");
  const [optionsByType, setOptionsByType] = useState<Record<string, Option[]>>({});
  const [themes, setThemes] = useState<ThemeInfo[]>([]);
  const [picks, setPicks] = useState<Option[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/data")
      .then((r) => r.json())
      .then((d) => {
        setOptionsByType(d.optionsByType);
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

  // If the server sent us stashed picks after a rejoin, look up the option objects
  // once we have both the answer set and the pending code list, then clear.
  useEffect(() => {
    if (!restoredPicks || !state?.currentQuestionMeta) return;
    const options = optionsByType[state.currentQuestionMeta.answerType] || [];
    if (options.length === 0) return;
    const byCode = new Map(options.map((o) => [o.code, o]));
    const resolved = restoredPicks.map((c) => byCode.get(c)).filter((x): x is Option => !!x);
    if (resolved.length) setPicks(resolved);
    consumeRestoredPicks();
  }, [restoredPicks, optionsByType, state?.currentQuestionMeta, consumeRestoredPicks]);

  // If we joined via /room/NEW, the server assigned a real code. Rewrite the URL
  // so refreshes go to the same room instead of minting a new one.
  useEffect(() => {
    if (state?.roomCode && state.roomCode !== code.toUpperCase()) {
      router.replace(`/room/${state.roomCode}`);
    }
  }, [state?.roomCode, code, router]);

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

  const onLeave = () => {
    emit("leave_room");
    router.push("/");
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <RoomHeader state={state} onCopy={(msg) => setToast(msg)} onLeave={onLeave} />
      {state.phase === "lobby" && (
        <LobbyView
          state={state}
          themes={themes}
          isHost={isHost}
          myUserId={userId}
          onStart={() => emit("start_game")}
          onUpdateSettings={(partial) => emit("update_settings", partial)}
          onTransferHost={(toId) => emit("transfer_host", { toPlayerId: toId })}
        />
      )}
      {state.phase === "playing" && (() => {
        const meta = state.currentQuestionMeta;
        const allOptions = optionsByType[meta?.answerType ?? ""] ?? [];
        const filtered = meta?.codeFilter
          ? allOptions.filter((o) => o.code.startsWith(meta.codeFilter!))
          : allOptions;
        return (
          <PlayingView
            state={state}
            options={filtered}
            picks={picks}
            setPicks={(next) => {
              setPicks(next);
              emit("stage_picks", { picks: next.map((c) => c.code) });
            }}
            now={now}
            me={me}
            onSubmit={() => emit("submit_picks", { picks: picks.map((c) => c.code) })}
          />
        );
      })()}
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

function RoomHeader({ state, onCopy, onLeave }: { state: ClientRoomState; onCopy: (msg: string) => void; onLeave: () => void }) {
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
          <Tooltip title="Leave room">
            <IconButton onClick={onLeave} size="small">
              <ArrowBackIcon />
            </IconButton>
          </Tooltip>
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
  myUserId,
  onStart,
  onUpdateSettings,
  onTransferHost,
}: {
  state: ClientRoomState;
  themes: ThemeInfo[];
  isHost: boolean;
  myUserId: string;
  onStart: () => void;
  onUpdateSettings: (partial: Partial<GameSettings>) => void;
  onTransferHost: (toPlayerId: string) => void;
}) {
  const s = state.settings;
  const currentTheme = themes.find((t) => t.theme === s.theme);
  const subthemes = currentTheme?.subthemes ?? [];
  const currentSubtheme = s.subtheme && s.subtheme !== "*"
    ? subthemes.find((st) => st.subtheme === s.subtheme)
    : undefined;
  const maxQuestions = currentSubtheme ? currentSubtheme.count : currentTheme?.count ?? 1;
  useEffect(() => {
    if (isHost && s.numQuestions > maxQuestions) {
      onUpdateSettings({ numQuestions: maxQuestions });
    }
  }, [isHost, maxQuestions, s.numQuestions, onUpdateSettings]);

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
          <Typography variant="subtitle2" gutterBottom color="text.secondary">
            Players ({state.players.filter((p) => p.connected).length} online)
          </Typography>
          <Stack direction="row" flexWrap="wrap" gap={1}>
            {state.players.map((p) => (
              <Chip
                key={p.id}
                label={
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    <Typography variant="body2" component="span">
                      {p.name}
                      {p.isHost && " ★"}
                      {p.id === myUserId && !p.isHost && " (you)"}
                    </Typography>
                  </Stack>
                }
                color={p.connected ? "primary" : "default"}
                variant={p.connected ? "filled" : "outlined"}
                onDelete={isHost && !p.isHost && p.connected ? () => onTransferHost(p.id) : undefined}
                deleteIcon={
                  isHost && !p.isHost && p.connected ? (
                    <Tooltip title="Make host">
                      <StarIcon fontSize="small" />
                    </Tooltip>
                  ) : undefined
                }
              />
            ))}
          </Stack>
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

            {subthemes.length > 0 && (
              <FormControl fullWidth>
                <InputLabel>Filter by subtheme</InputLabel>
                <Select
                  label="Filter by subtheme"
                  value={s.subtheme || "*"}
                  onChange={(e) => onUpdateSettings({ subtheme: e.target.value })}
                >
                  <MenuItem value="*">
                    All ({currentTheme?.count ?? 0} question{currentTheme?.count === 1 ? "" : "s"})
                  </MenuItem>
                  {subthemes.map((st) => (
                    <MenuItem key={st.subtheme} value={st.subtheme}>
                      {st.subtheme} ({st.count})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

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
          {s.subtheme && s.subtheme !== "*" && (
            <Typography variant="body2">Subtheme: <strong>{s.subtheme}</strong></Typography>
          )}
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
  options,
  picks,
  setPicks,
  now,
  me,
  onSubmit,
}: {
  state: ClientRoomState;
  options: Option[];
  picks: Option[];
  setPicks: (v: Option[]) => void;
  now: number;
  me: ClientRoomState["players"][number] | undefined;
  onSubmit: () => void;
}) {
  const meta = state.currentQuestionMeta;
  if (!meta) return null;
  const secondsLeft = state.endsAt ? Math.max(0, Math.ceil((state.endsAt - now) / 1000)) : 0;
  const optionsSorted = useMemo(() => [...options].sort((a, b) => a.name.localeCompare(b.name)), [options]);
  const submitted = me?.submitted ?? false;
  const unitLabel = itemLabelForType(meta.answerType);

  return (
    <Stack spacing={3}>
      <Paper sx={{ p: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems={{ sm: "center" }} flexWrap="wrap" gap={2}>
          <Box>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                Question {state.currentQuestionIdx + 1} of {state.totalQuestions}
              </Typography>
              {meta.asOfDate && (
                <Chip label={`as of ${meta.asOfDate}`} size="small" variant="outlined" />
              )}
            </Stack>
            <Typography variant="h5" fontWeight={700}>
              {meta.title}
            </Typography>
          </Box>
          <Typography variant="h3" fontWeight={800} color={secondsLeft <= 10 ? "error" : "primary"}>
            {secondsLeft}s
          </Typography>
        </Stack>
        <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
          {meta.prompt} Pick {meta.picksPerPlayer === 1 ? `one ${unitLabel.singular}` : `up to ${meta.picksPerPlayer} ${unitLabel.plural}`} from the top {meta.topN}.
        </Typography>
        {meta.disclaimer && (
          <Alert severity="info" sx={{ mt: 2 }}>
            {meta.disclaimer}
          </Alert>
        )}
        <Autocomplete
          multiple={meta.picksPerPlayer > 1}
          options={optionsSorted}
          value={meta.picksPerPlayer > 1 ? picks : picks[0] ?? null}
          onChange={(_, v) => {
            if (meta.picksPerPlayer === 1) {
              setPicks(v ? [v as Option] : []);
            } else {
              setPicks((v as Option[]).slice(0, meta.picksPerPlayer));
            }
          }}
          getOptionLabel={(o) => (o as Option).name}
          isOptionEqualToValue={(a, b) => (a as Option).code === (b as Option).code}
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
  const scoreboard = [...state.players].sort((a, b) => b.score - a.score);
  const isLast = state.currentQuestionIdx + 1 >= state.totalQuestions;

  return (
    <Stack spacing={3}>
      <Paper sx={{ p: 3 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            Question {state.currentQuestionIdx + 1} of {state.totalQuestions} — Results
          </Typography>
          {r.asOfDate && (
            <Chip label={`as of ${r.asOfDate}`} size="small" variant="outlined" />
          )}
        </Stack>
        <Typography variant="h5" fontWeight={700} gutterBottom>
          {r.questionTitle}
        </Typography>
        <Alert severity="success" sx={{ mb: 2 }}>
          Source: <strong>{r.source.name}</strong>
          {r.source.url && (
            <>
              {" — "}
              <MuiLink href={r.source.url} target="_blank" rel="noreferrer">
                view
              </MuiLink>
            </>
          )}
        </Alert>
        <Typography variant="h6" gutterBottom>
          Correct answers
        </Typography>
        <Stack spacing={0.5}>
          {r.correctAnswers.map((a) => (
            <Stack key={`${a.rank}-${a.code}`} direction="row" spacing={2}>
              <Typography sx={{ width: 32, fontWeight: 700 }}>#{a.rank}</Typography>
              <Typography sx={{ flex: 1 }}>{a.label}</Typography>
              <Typography color="text.secondary">{a.value}</Typography>
            </Stack>
          ))}
        </Stack>
        {(r.disclaimer || r.trivia) && (
          <Box sx={{ mt: 3 }}>
            {r.disclaimer && (
              <Alert severity="info" sx={{ mb: r.trivia ? 1.5 : 0 }}>
                <strong>Note:</strong> {r.disclaimer}
              </Alert>
            )}
            {r.trivia && (
              <Alert severity="warning" icon={false} sx={{ backgroundColor: "rgba(124,92,255,0.12)", color: "inherit" }}>
                <strong>Did you know?</strong> {r.trivia}
              </Alert>
            )}
          </Box>
        )}
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
  return <AnimatedFinalScoreboard scoreboard={scoreboard} isHost={isHost} onLobby={onLobby} />;
}

function AnimatedFinalScoreboard({
  scoreboard,
  isHost,
  onLobby,
}: {
  scoreboard: FinalScoreboardEntry[];
  isHost: boolean;
  onLobby: () => void;
}) {
  // Reveal from last place upward — build the order and animate one-per-tick.
  // We reveal N-th, N-1-th, ..., 2nd, then a longer pause, then 1st with confetti.
  const [revealedCount, setRevealedCount] = useState(0);

  useEffect(() => {
    if (scoreboard.length === 0) return;
    setRevealedCount(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    // Reveal ranks N..2 with short interval, then rank 1 with a dramatic pause.
    const stepMs = 900;
    const finalPause = 1600;
    for (let i = 0; i < scoreboard.length - 1; i++) {
      timers.push(setTimeout(() => setRevealedCount(i + 1), (i + 1) * stepMs));
    }
    // The winner reveals after all runners-up + dramatic pause
    timers.push(
      setTimeout(() => {
        setRevealedCount(scoreboard.length);
        // Fire confetti when the winner card appears
        fireWinnerConfetti();
      }, (scoreboard.length - 1) * stepMs + finalPause)
    );
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [scoreboard]);

  const allRevealed = revealedCount === scoreboard.length;

  return (
    <Stack spacing={3}>
      <Paper
        sx={{
          p: { xs: 3, sm: 4 },
          background: allRevealed
            ? "linear-gradient(135deg, rgba(124,92,255,0.15) 0%, rgba(255,167,38,0.15) 100%)"
            : undefined,
          transition: "background 900ms ease",
        }}
      >
        <Typography variant="overline" color="text.secondary">
          Game complete
        </Typography>
        <Typography variant="h4" fontWeight={800} gutterBottom>
          Final scoreboard
        </Typography>
        <Stack spacing={1.5} sx={{ mt: 3, position: "relative" }}>
          {/* Render from last place down so the visual list reads top-to-bottom
              once complete, but reveal is bottom-up. */}
          {scoreboard.map((entry, i) => {
            const rankFromTop = i; // 0 = winner
            const revealIdx = scoreboard.length - 1 - rankFromTop; // last place = 0, winner = N-1
            const isVisible = revealIdx < revealedCount;
            const isWinner = rankFromTop === 0;
            return (
              <ScoreboardRow
                key={entry.playerId}
                entry={entry}
                place={rankFromTop + 1}
                isWinner={isWinner}
                isVisible={isVisible}
                allRevealed={allRevealed}
              />
            );
          })}
        </Stack>
      </Paper>
      {isHost ? (
        <Button variant="contained" size="large" onClick={onLobby} disabled={!allRevealed}>
          {allRevealed ? "Back to lobby (new game)" : "Revealing..."}
        </Button>
      ) : (
        <Typography variant="body2" color="text.secondary" textAlign="center">
          {allRevealed ? "Waiting for host to start a new game..." : "Revealing..."}
        </Typography>
      )}
    </Stack>
  );
}

function ScoreboardRow({
  entry,
  place,
  isWinner,
  isVisible,
  allRevealed,
}: {
  entry: FinalScoreboardEntry;
  place: number;
  isWinner: boolean;
  isVisible: boolean;
  allRevealed: boolean;
}) {
  // Count-up score animation, kicked off when the row becomes visible.
  const [displayScore, setDisplayScore] = useState(0);
  useEffect(() => {
    if (!isVisible) return;
    const duration = isWinner ? 1400 : 700;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplayScore(Math.round(entry.score * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isVisible, entry.score, isWinner]);

  const medal = place === 1 ? "🥇" : place === 2 ? "🥈" : place === 3 ? "🥉" : `#${place}`;

  return (
    <Box
      sx={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? "translateY(0) scale(1)" : "translateY(20px) scale(0.98)",
        transition: "opacity 500ms ease, transform 500ms cubic-bezier(0.22, 1, 0.36, 1)",
        py: isWinner ? 2 : 1,
        px: isWinner ? 2 : 0,
        borderRadius: 2,
        background: isWinner && allRevealed
          ? "linear-gradient(90deg, rgba(255,215,0,0.18) 0%, rgba(255,167,38,0.10) 100%)"
          : undefined,
        boxShadow: isWinner && allRevealed ? "0 0 24px rgba(255,215,0,0.35)" : undefined,
        animation: isWinner && allRevealed ? "winnerPulse 2s ease-in-out infinite" : undefined,
        "@keyframes winnerPulse": {
          "0%, 100%": { boxShadow: "0 0 24px rgba(255,215,0,0.35)" },
          "50%": { boxShadow: "0 0 40px rgba(255,215,0,0.55)" },
        },
      }}
    >
      <Stack direction="row" alignItems="center" spacing={2}>
        <Typography
          sx={{
            width: isWinner ? 60 : 44,
            fontWeight: 800,
            textAlign: "center",
          }}
          variant={isWinner ? "h3" : place <= 3 ? "h4" : "h6"}
          color={isWinner ? "warning.main" : "text.secondary"}
        >
          {medal}
        </Typography>
        <Typography
          sx={{ flex: 1 }}
          fontWeight={isWinner ? 800 : place <= 3 ? 700 : 500}
          variant={isWinner ? "h3" : place <= 3 ? "h5" : "body1"}
        >
          {entry.name}
        </Typography>
        <Typography
          fontWeight={800}
          variant={isWinner ? "h3" : place <= 3 ? "h5" : "body1"}
          color={isWinner ? "warning.main" : undefined}
          sx={{ fontVariantNumeric: "tabular-nums" }}
        >
          {displayScore}
        </Typography>
      </Stack>
    </Box>
  );
}

async function fireWinnerConfetti() {
  const confettiMod = await import("canvas-confetti");
  const confetti = confettiMod.default;
  const duration = 2500;
  const end = Date.now() + duration;
  const colors = ["#ffd700", "#ffa726", "#7c5cff", "#ff6ec7", "#ffffff"];

  // Initial burst
  confetti({
    particleCount: 120,
    spread: 80,
    origin: { y: 0.35 },
    colors,
  });
  // Side cannons
  const interval = setInterval(() => {
    if (Date.now() > end) {
      clearInterval(interval);
      return;
    }
    confetti({
      particleCount: 30,
      angle: 60,
      spread: 55,
      startVelocity: 55,
      origin: { x: 0, y: 0.7 },
      colors,
    });
    confetti({
      particleCount: 30,
      angle: 120,
      spread: 55,
      startVelocity: 55,
      origin: { x: 1, y: 0.7 },
      colors,
    });
  }, 250);
}
