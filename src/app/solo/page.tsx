"use client";
import {
  Box,
  Button,
  Container,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
  Alert,
} from "@mui/material";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ScoringMode } from "@/lib/types";

type ThemeInfo = { theme: string; count: number };

const ALL_THEME = "*";

const MODE_LABEL: Record<ScoringMode, string> = {
  rank: "Rank",
  inverse: "Inverse",
  flat: "Flat",
};
const MODE_DESC: Record<ScoringMode, string> = {
  rank: "Obscure answers score more (top-10 = 10 pts, top-1 = 1)",
  inverse: "Popular answers score more (top-1 = 10 pts, top-10 = 1)",
  flat: "Every correct answer scores 1 point",
};

const VALID_MODES: ScoringMode[] = ["rank", "inverse", "flat"];

function SoloInner() {
  const router = useRouter();
  const search = useSearchParams();
  const [name, setName] = useState(search.get("name") || "");
  const [themes, setThemes] = useState<ThemeInfo[]>([]);
  // Read initial mode/theme from URL params first, then localStorage, then defaults.
  const [theme, setTheme] = useState<string>(() => {
    const urlTheme = search.get("theme");
    if (urlTheme) return urlTheme;
    if (typeof window !== "undefined") {
      const cached = localStorage.getItem("topten_last_theme");
      if (cached) return cached;
    }
    return ALL_THEME;
  });
  const [mode, setMode] = useState<ScoringMode>(() => {
    const urlMode = search.get("mode");
    if (urlMode && VALID_MODES.includes(urlMode as ScoringMode)) return urlMode as ScoringMode;
    if (typeof window !== "undefined") {
      const cached = localStorage.getItem("topten_last_mode");
      if (cached && VALID_MODES.includes(cached as ScoringMode)) return cached as ScoringMode;
    }
    return "rank";
  });
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!name) {
      const saved = typeof window !== "undefined" ? localStorage.getItem("topten_name") : null;
      if (saved) setName(saved);
    }
  }, [name]);

  useEffect(() => {
    fetch("/api/solo/themes")
      .then((r) => r.json())
      .then((d) => setThemes(d.themes || []))
      .catch(() => setError("Failed to load themes"));
  }, []);

  const persistName = (n: string) => {
    setName(n);
    localStorage.setItem("topten_name", n);
  };

  const start = async () => {
    if (!name.trim()) return;
    setStarting(true);
    setError(null);
    // Remember this pair for next time (Play Again + returning visits).
    localStorage.setItem("topten_last_mode", mode);
    localStorage.setItem("topten_last_theme", theme);
    try {
      const res = await fetch("/api/solo/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), mode, theme }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error || "Failed to start");
        setStarting(false);
        return;
      }
      const s = await res.json();
      router.push(`/solo/play/${s.sessionId}`);
    } catch {
      setError("Network error");
      setStarting(false);
    }
  };

  // Auto-start when caller passes ?auto=1 (results page Play Again path).
  const autoStart = search.get("auto") === "1";
  useEffect(() => {
    if (!autoStart) return;
    if (!name.trim()) return;
    if (starting) return;
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, name]);

  return (
    <Container maxWidth="sm" sx={{ py: 6 }}>
      <Stack spacing={3}>
        <Box>
          <Button size="small" onClick={() => router.push("/")}>← Home</Button>
        </Box>
        <Box textAlign="center">
          <Typography variant="h3" fontWeight={800}>Solo Play</Typography>
          <Typography variant="body2" color="text.secondary" mt={1}>
            10 questions · 1 pick each · 30 seconds per question
          </Typography>
        </Box>
        <Paper sx={{ p: 4 }}>
          <Stack spacing={3}>
            <TextField
              label="Display name"
              value={name}
              onChange={(e) => persistName(e.target.value)}
              fullWidth
              inputProps={{ maxLength: 24 }}
            />
            <FormControl fullWidth>
              <InputLabel>Category</InputLabel>
              <Select value={theme} label="Category" onChange={(e) => setTheme(e.target.value)}>
                <MenuItem value={ALL_THEME}>All categories (mixed)</MenuItem>
                {themes.map((t) => (
                  <MenuItem key={t.theme} value={t.theme}>
                    {t.theme} ({t.count})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Mode</InputLabel>
              <Select value={mode} label="Mode" onChange={(e) => setMode(e.target.value as ScoringMode)}>
                {(["rank", "inverse", "flat"] as ScoringMode[]).map((m) => (
                  <MenuItem key={m} value={m}>{MODE_LABEL[m]}</MenuItem>
                ))}
              </Select>
              <Typography variant="caption" color="text.secondary" mt={1}>
                {MODE_DESC[mode]}
              </Typography>
            </FormControl>
            {error && <Alert severity="error">{error}</Alert>}
            <Button variant="contained" size="large" disabled={!name.trim() || starting} onClick={start}>
              {starting ? "Starting..." : "Start"}
            </Button>
            <Button variant="text" size="small" onClick={() => router.push(`/leaderboard?mode=${mode}&theme=${encodeURIComponent(theme)}`)}>
              View this leaderboard
            </Button>
          </Stack>
        </Paper>
      </Stack>
    </Container>
  );
}

export default function SoloPage() {
  return (
    <Suspense fallback={null}>
      <SoloInner />
    </Suspense>
  );
}
