import type { Metadata } from "next";
import ThemeRegistry from "@/components/ThemeRegistry";
import "./globals.css";

export const metadata: Metadata = {
  title: "Top Ten",
  description: "A multiplayer top-10 guessing game",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ThemeRegistry>
          <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
            <div style={{ flex: 1 }}>{children}</div>
            <footer style={{ textAlign: "center", padding: "24px 0", opacity: 0.5, fontSize: "0.75rem" }}>
              Made by Declan Edgecombe
            </footer>
          </div>
        </ThemeRegistry>
      </body>
    </html>
  );
}
