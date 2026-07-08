"use client";
import { Box, Button, Container, FormControlLabel, Stack, Switch, TextField, Typography, Paper } from "@mui/material";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function HomeInner() {
  const router = useRouter();
  const search = useSearchParams();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [devMode, setDevMode] = useState(false);

  useEffect(() => {
    const savedName = localStorage.getItem("topten_name");
    if (savedName) setName(savedName);
    const joinCode = search.get("joinCode");
    if (joinCode) setCode(joinCode.toUpperCase());
    setDevMode(localStorage.getItem("topten_dev_mode") === "1");
  }, [search]);

  const toggleDevMode = (v: boolean) => {
    setDevMode(v);
    localStorage.setItem("topten_dev_mode", v ? "1" : "0");
  };

  const persistName = (n: string) => {
    setName(n);
    localStorage.setItem("topten_name", n);
  };

  const create = () => {
    if (!name.trim()) return;
    router.push(`/room/NEW?name=${encodeURIComponent(name)}`);
  };
  const join = () => {
    if (!name.trim() || !code.trim()) return;
    router.push(`/room/${code.toUpperCase()}?name=${encodeURIComponent(name)}`);
  };

  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Stack spacing={4} alignItems="center">
        <Box textAlign="center">
          <Typography variant="h2" fontWeight={800} letterSpacing={-1}>
            Top&nbsp;Ten
          </Typography>
          <Typography variant="body1" color="text.secondary" mt={1}>
            Guess the top items in a category. Beat your friends. Learn some geography.
          </Typography>
        </Box>
        <Paper sx={{ p: 4, width: "100%" }}>
          <Stack spacing={2}>
            <TextField
              label="Your name"
              value={name}
              onChange={(e) => persistName(e.target.value)}
              fullWidth
              autoFocus
              inputProps={{ maxLength: 24 }}
            />
            <Button variant="contained" size="large" disabled={!name.trim()} onClick={create}>
              Create Room
            </Button>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
              <Box sx={{ flex: 1, height: 1, bgcolor: "divider" }} />
              <Typography variant="caption" color="text.secondary">
                OR
              </Typography>
              <Box sx={{ flex: 1, height: 1, bgcolor: "divider" }} />
            </Box>
            <TextField
              label="Room code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              fullWidth
              inputProps={{ maxLength: 4, style: { textTransform: "uppercase", letterSpacing: 4 } }}
            />
            <Button variant="outlined" size="large" disabled={!name.trim() || !code.trim()} onClick={join}>
              Join Room
            </Button>
          </Stack>
        </Paper>
        <Paper sx={{ p: 4, width: "100%" }}>
          <Stack spacing={2}>
            <Typography variant="h6">Play Solo</Typography>
            <Typography variant="body2" color="text.secondary">
              10 questions, 30 seconds each. Compete on global leaderboards.
            </Typography>
            <Button
              variant="contained"
              color="secondary"
              size="large"
              disabled={!name.trim()}
              onClick={() => router.push(`/solo?name=${encodeURIComponent(name)}`)}
            >
              Solo Play
            </Button>
            <Button variant="text" size="small" onClick={() => router.push("/leaderboard")}>
              View Leaderboards
            </Button>
          </Stack>
        </Paper>
        <FormControlLabel
          control={<Switch checked={devMode} onChange={(_, v) => toggleDevMode(v)} />}
          label={
            <Typography variant="caption" color="text.secondary">
              Dev mode — require feedback before advancing each round
            </Typography>
          }
        />
      </Stack>
    </Container>
  );
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeInner />
    </Suspense>
  );
}
