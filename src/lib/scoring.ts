import type { ScoringMode } from "./types";

export function scorePick(mode: ScoringMode, rank: number | null, topN: number, missPenalty: number): number {
  if (rank === null || rank > topN) return -missPenalty;
  switch (mode) {
    case "rank":
      return rank;
    case "inverse":
      return topN - rank + 1;
    case "flat":
      return 1;
  }
}
