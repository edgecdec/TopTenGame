"use client";
import { Box, Button, Container, Stack, TextField, Typography, Paper } from "@mui/material";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

function ensureUserId() {
  if (typeof document === "undefined") return;
  const has = document.cookie.split("; ").some((c) => c.startsWith("topten_user_id="));
  if (!has) {
    const id = crypto.randomUUID();
    document.cookie = `topten_user_id=${id}; path=/; max-age=31536000; SameSite=Lax`;
  }
}

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  useEffect(() => {
    ensureUserId();
    const savedName = localStorage.getItem("topten_name");
    if (savedName) setName(savedName);
  }, []);

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
      </Stack>
    </Container>
  );
}
