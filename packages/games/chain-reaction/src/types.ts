// Chain Reaction state shapes (CLAUDE.md §7), extended for multi-round matches
// ("best across roundsPerMatch") and to carry config so applyMove stays pure.

export interface ChainRung {
  answer: string; // hidden — must never survive redact() while unsolved
  revealed: number; // letters shown from the left, 0..answer.length
  value: number; // current pot, starts at config.startingValue
  solvedBy: string | null;
}

// Tuning knobs — live in config so they change without code edits (§7).
export interface ChainConfig {
  startingValue: number; // 10
  peekPenalty: number; // 2
  valueFloor: number; // 2
  middleRungs: number; // 2–3
  roundsPerMatch: number;
}

export const DEFAULT_CHAIN_CONFIG: ChainConfig = {
  startingValue: 10,
  peekPenalty: 2,
  valueFloor: 2,
  middleRungs: 3,
  roundsPerMatch: 3,
};

export interface ChainState {
  config: ChainConfig;
  seed: string; // match seed; per-round chains derive deterministically from it
  order: string[]; // turn order (playerIds)
  round: number; // 0-based index of the current round
  roundWins: Record<string, number>; // rounds won so far (the match tally)
  // --- current round ---
  start: string;
  end: string;
  rungs: ChainRung[];
  scores: Record<string, number>; // points this round
  turn: string; // playerId whose action it is
  matchOver: boolean;
}

// A player picks exactly ONE action per turn.
export type ChainMove =
  | { kind: 'peek'; rung: number }
  | { kind: 'solve'; rung: number; guess: string };

// Redacted per-rung view: never the full answer or unrevealed letters (unsolved).
export interface ChainRungView {
  revealed: number; // letters shown (== length once solved)
  shown: string; // first `revealed` letters; full word only once solved
  length: number; // answer.length
  value: number;
  solvedBy: string | null;
}

export interface ChainView {
  start: string;
  end: string;
  rungs: ChainRungView[];
  scores: Record<string, number>;
  turn: string;
  order: string[];
  round: number;
  roundsPerMatch: number;
  roundWins: Record<string, number>;
  matchOver: boolean;
}
