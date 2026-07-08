"use client";
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
  Stack,
  Typography,
} from "@mui/material";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ScoringMode } from "@/lib/types";

type ThemeInfo = { theme: string; count: number };
type LeaderboardEntry = { rank: number; displayName: string; score: number; isYou: boolean; createdAt: number };

const ALL_THEME = "*";
const MODE_LABEL: Record<ScoringMode, string> = { rank: "Rank", inverse: "Inverse", flat: "Flat" };

function LeaderboardInner() {
  const router = useRouter();
  const search = useSearchParams();
  const [mode, setMode] = useState<ScoringMode>((search.get("mode") as ScoringMode) || "rank");
  const [theme, setTheme] = useState<string>(search.get("theme") || ALL_THEME);
  const [themes, setThemes] = useState<ThemeInfo[]>([]);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [best, setBest] = useState<{ score: number; rank: number | null } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/solo/themes")
      .then((r) => r.json())
      .then((d) => setThemes(d.themes || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/leaderboard?mode=${mode}&theme=${encodeURIComponent(theme)}`)
      .then((r) => r.json())
      .then((d) => {
        setEntries(d.entries || []);
        setBest(d.best || null);
      })
      .finally(() => setLoading(false));
  }, [mode, theme]);

  const themeLabel = theme === ALL_THEME ? "All categories" : theme;

  return (
    <Container maxWidth="sm" sx={{ py: 6 }}>
      <Stack spacing={3}>
        <Box>
          <Button size="small" onClick={() => router.push("/")}>← Home</Button>
        </Box>
        <Typography variant="h4" fontWeight={800}>Leaderboards</Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <FormControl fullWidth size="small">
            <InputLabel>Category</InputLabel>
            <Select value={theme} label="Category" onChange={(e) => setTheme(e.target.value)}>
              <MenuItem value={ALL_THEME}>All categories</MenuItem>
              {themes.map((t) => (
                <MenuItem key={t.theme} value={t.theme}>
                  {t.theme}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl fullWidth size="small">
            <InputLabel>Mode</InputLabel>
            <Select value={mode} label="Mode" onChange={(e) => setMode(e.target.value as ScoringMode)}>
              {(["rank", "inverse", "flat"] as ScoringMode[]).map((m) => (
                <MenuItem key={m} value={m}>{MODE_LABEL[m]}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            {themeLabel} · {MODE_LABEL[mode]}
          </Typography>
          {best && (
            <Typography variant="caption" color="text.secondary" display="block" mb={1}>
              Your best: {best.score}
              {best.rank !== null ? ` (rank #${best.rank})` : ""}
            </Typography>
          )}
          <Divider sx={{ my: 1 }} />
          {loading ? (
            <Typography color="text.secondary">Loading…</Typography>
          ) : entries.length === 0 ? (
            <Typography color="text.secondary" variant="body2">No scores yet. Be the first!</Typography>
          ) : (
            <Stack spacing={0.5}>
              {entries.map((e) => (
                <Stack key={e.rank} direction="row" alignItems="center" spacing={1} sx={{ fontWeight: e.isYou ? 700 : 400 }}>
                  <Typography sx={{ width: 30, textAlign: "right" }}>#{e.rank}</Typography>
                  <Typography sx={{ flex: 1 }}>{e.displayName}</Typography>
                  <Typography>{e.score}</Typography>
                  {e.isYou && <Chip label="you" size="small" color="primary" />}
                </Stack>
              ))}
            </Stack>
          )}
        </Paper>
        <Button variant="contained" onClick={() => router.push(`/solo?mode=${mode}&theme=${encodeURIComponent(theme)}`)}>
          Play this board
        </Button>
      </Stack>
    </Container>
  );
}

export default function LeaderboardPage() {
  return (
    <Suspense fallback={null}>
      <LeaderboardInner />
    </Suspense>
  );
}
