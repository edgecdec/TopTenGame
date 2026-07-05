"use client";
import { ThemeProvider, CssBaseline, createTheme } from "@mui/material";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { useMemo } from "react";

export default function ThemeRegistry({ children }: { children: React.ReactNode }) {
  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: "dark",
          primary: { main: "#7c5cff" },
          secondary: { main: "#ffa726" },
          background: { default: "#0f1120", paper: "#1a1d34" },
        },
        shape: { borderRadius: 12 },
      }),
    []
  );
  return (
    <AppRouterCacheProvider>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}
