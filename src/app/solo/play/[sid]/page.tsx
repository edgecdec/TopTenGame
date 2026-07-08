"use client";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Container,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
  Link as MuiLink,
} from "@mui/material";
import ThumbUpIcon from "@mui/icons-material/ThumbUp";
import ThumbDownIcon from "@mui/icons-material/ThumbDown";
import ThumbUpOutlinedIcon from "@mui/icons-material/ThumbUpOutlined";
import ThumbDownOutlinedIcon from "@mui/icons-material/ThumbDownOutlined";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ScoringMode } from "@/lib/types";

type SoloQuestion = {
  id: string;
  title: string;
  prompt: string;
  answerType: string;
  disclaimer: string | null;
  asOfDate: string | null;
  topN: number;
  endsAt: number | null;
};

type SoloRoundResult = {
  questionId: string;
  questionTitle: string;
  yourPick: { code: string; label: string } | null;
  yourRank: number | null;
  pointsEarned: number;
  correctAnswers: Array<{ rank: number; code: string; value: string; label: string }>;
  source: { name: string; url: string; asOf: string };
  trivia: string | null;
};

type SoloState = {
  sessionId: string;
  mode: ScoringMode;
  theme: string;
  displayName: string;
  currentIdx: number;
  totalQuestions: number;
  score: number;
  finished: boolean;
  currentQuestion: SoloQuestion | null;
  lastResult: SoloRoundResult | null;
};

type Option = { code: string; name: string };

export default function PlayPage({ params }: { params: Promise<{ sid: string }> }) {
  const { sid } = use(params);
  const router = useRouter();
  const [state, setState] = useState<SoloState | null>(null);
  const [options, setOptions] = useState<Record<string, Option[]>>({});
  const [pick, setPick] = useState<Option | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showIntermission, setShowIntermission] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const autoSubmittedFor = useRef<string | null>(null);

  useEffect(() => {
    fetch("/api/data")
      .then((r) => r.json())
      .then((d) => setOptions(d.optionsByType || {}))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`/api/solo/${sid}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((s: SoloState) => {
        setState(s);
        if (s.finished) {
          router.replace(`/solo/results/${sid}`);
          return;
        }
        // Mid-intermission on load: server has lastResult but hasn't started
        // the next question's timer yet — restore the intermission view.
        if (s.lastResult && s.currentQuestion && !s.currentQuestion.endsAt) {
          setShowIntermission(true);
        }
      })
      .catch(() => setError("Session not found."));
  }, [sid, router]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const doSubmit = useCallback(
    async (code: string | null) => {
      if (!state || submitting) return;
      setSubmitting(true);
      try {
        const res = await fetch(`/api/solo/${sid}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pick: code }),
        });
        if (!res.ok) {
          setError("Submit failed");
          setSubmitting(false);
          return;
        }
        const next: SoloState = await res.json();
        setState(next);
        setPick(null);
        setShowIntermission(true);
      } catch {
        setError("Network error");
      } finally {
        setSubmitting(false);
      }
    },
    [state, submitting, sid]
  );

  // Timer expiry auto-submit
  useEffect(() => {
    if (!state?.currentQuestion || showIntermission) return;
    const endsAt = state.currentQuestion.endsAt;
    if (!endsAt) return;
    if (now < endsAt) return;
    if (autoSubmittedFor.current === state.currentQuestion.id) return;
    autoSubmittedFor.current = state.currentQuestion.id;
    doSubmit(pick?.code ?? null);
  }, [now, state, showIntermission, pick, doSubmit]);

  const advance = useCallback(async () => {
    if (!state) return;
    if (state.finished) {
      router.push(`/solo/results/${sid}`);
      return;
    }
    // Start the next round's timer server-side before flipping out of intermission.
    try {
      const res = await fetch(`/api/solo/${sid}/start-round`, { method: "POST" });
      if (res.ok) {
        const next: SoloState = await res.json();
        setState(next);
      }
    } catch {
      /* keep existing state; setShowIntermission still flips */
    }
    autoSubmittedFor.current = null;
    setShowIntermission(false);
  }, [state, sid, router]);

  if (error) {
    return (
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <Alert severity="error">{error}</Alert>
        <Button sx={{ mt: 2 }} onClick={() => router.push("/solo")}>← New game</Button>
      </Container>
    );
  }
  if (!state) {
    return <Container maxWidth="sm" sx={{ py: 6 }}><Typography>Loading…</Typography></Container>;
  }

  if (showIntermission && state.lastResult) {
    const r = state.lastResult;
    const isLast = state.finished;
    return (
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <Stack spacing={2}>
          <Typography variant="overline" color="text.secondary">
            Question {state.currentIdx} of {state.totalQuestions} · Score {state.score}
          </Typography>
          <Typography variant="h5">{r.questionTitle}</Typography>
          <Paper sx={{ p: 2 }}>
            {r.yourPick ? (
              <Typography>
                Your pick: <b>{r.yourPick.label}</b>{" "}
                {r.yourRank !== null ? (
                  <Chip label={`#${r.yourRank} · +${r.pointsEarned}`} color="success" size="small" />
                ) : (
                  <Chip label={`Miss · +${r.pointsEarned}`} size="small" />
                )}
              </Typography>
            ) : (
              <Typography color="text.secondary">No pick this round.</Typography>
            )}
          </Paper>
          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle2" gutterBottom>Correct top {r.correctAnswers.length}</Typography>
            <Stack spacing={0.5}>
              {r.correctAnswers.map((a) => (
                <Typography key={a.code} variant="body2">
                  #{a.rank} {a.label} — {a.value}
                </Typography>
              ))}
            </Stack>
          </Paper>
          {r.trivia && (
            <Alert severity="info" icon={false}>{r.trivia}</Alert>
          )}
          <Typography variant="caption" color="text.secondary">
            Source: {r.source.url ? (
              <MuiLink href={r.source.url} target="_blank" rel="noreferrer">{r.source.name}</MuiLink>
            ) : r.source.name}
            {r.source.asOf ? ` · ${r.source.asOf}` : ""}
          </Typography>
          <FeedbackWidget sessionId={sid} questionId={r.questionId} />
          <Button variant="contained" size="large" onClick={advance}>
            {isLast ? "See final score" : "Next question"}
          </Button>
        </Stack>
      </Container>
    );
  }

  const q = state.currentQuestion;
  if (!q) return <Container maxWidth="sm" sx={{ py: 6 }}><Typography>Loading question…</Typography></Container>;

  const opts = options[q.answerType] || [];
  const secondsLeft = q.endsAt ? Math.max(0, Math.ceil((q.endsAt - now) / 1000)) : 30;
  const timerPct = q.endsAt ? Math.max(0, Math.min(100, ((q.endsAt - now) / (30 * 1000)) * 100)) : 100;

  return (
    <Container maxWidth="sm" sx={{ py: 6 }}>
      <Stack spacing={3}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="overline" color="text.secondary">
            Question {state.currentIdx + 1} of {state.totalQuestions}
          </Typography>
          <Chip label={`Score: ${state.score}`} color="primary" />
        </Stack>
        <Box>
          <LinearProgress variant="determinate" value={timerPct} sx={{ height: 8, borderRadius: 1 }} />
          <Typography variant="caption" color="text.secondary">{secondsLeft}s left</Typography>
        </Box>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h5" gutterBottom>{q.title}</Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>{q.prompt}</Typography>
          <Typography variant="caption" color="text.secondary">
            Guess one answer that appears in the top {q.topN}
            {q.asOfDate ? ` · Data as of ${q.asOfDate}` : ""}
          </Typography>
          {q.disclaimer && (
            <Alert severity="info" sx={{ mt: 2 }} icon={false}>{q.disclaimer}</Alert>
          )}
        </Paper>
        <Autocomplete
          options={opts}
          value={pick}
          onChange={(_, v) => setPick(v)}
          getOptionLabel={(o) => o?.name || ""}
          isOptionEqualToValue={(a, b) => a.code === b.code}
          renderInput={(params) => <TextField {...params} label="Your pick" placeholder={`Search ${q.answerType.toLowerCase()}…`} />}
        />
        <Button
          variant="contained"
          size="large"
          disabled={!pick || submitting || secondsLeft === 0}
          onClick={() => doSubmit(pick?.code ?? null)}
        >
          Submit
        </Button>
      </Stack>
    </Container>
  );
}

function FeedbackWidget({ sessionId, questionId }: { sessionId: string; questionId: string }) {
  const [thumbs, setThumbs] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!expanded && !thumbs) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, questionId, thumbs, text: text.trim() || null }),
      })
        .then(() => {
          setSaved(true);
          setTimeout(() => setSaved(false), 1500);
        })
        .catch(() => {});
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumbs, text]);

  return (
    <Box sx={{ borderTop: 1, borderColor: "divider", pt: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
        <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
          How was this question?
        </Typography>
        <Tooltip title="Good question">
          <IconButton
            size="small"
            color={thumbs === 1 ? "success" : "default"}
            onClick={() => setThumbs(thumbs === 1 ? null : 1)}
          >
            {thumbs === 1 ? <ThumbUpIcon fontSize="small" /> : <ThumbUpOutlinedIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Bad question">
          <IconButton
            size="small"
            color={thumbs === -1 ? "error" : "default"}
            onClick={() => setThumbs(thumbs === -1 ? null : -1)}
          >
            {thumbs === -1 ? <ThumbDownIcon fontSize="small" /> : <ThumbDownOutlinedIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        <Button size="small" onClick={() => setExpanded(!expanded)} sx={{ ml: 0.5, textTransform: "none" }}>
          {expanded ? "Hide comment" : "Add comment"}
        </Button>
        {saved && (
          <Typography variant="caption" color="success.main">
            Saved
          </Typography>
        )}
      </Stack>
      {expanded && (
        <TextField
          fullWidth
          multiline
          minRows={2}
          maxRows={4}
          size="small"
          margin="dense"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 500))}
          placeholder="Anything wrong with this question? Confusing prompt, bad answer, wrong source, etc."
          helperText={`${text.length}/500`}
        />
      )}
    </Box>
  );
}
