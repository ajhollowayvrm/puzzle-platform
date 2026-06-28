// Chain Reaction state shapes (CLAUDE.md §7). Implementation lands in Phase 1.

export interface ChainRung {
  answer: string; // hidden — must never survive redact() while unsolved
  revealed: number; // letters shown from the left, 0..answer.length
  value: number; // current pot, starts at config.startingValue
  solvedBy: string | null;
}

export interface ChainState {
  start: string;
  end: string;
  rungs: ChainRung[];
  scores: Record<string, number>;
  turn: string; // playerId
  order: string[]; // turn order
}

// Tuning knobs — live in match config so they change without code edits (§7).
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

// A player picks exactly ONE action per turn.
export type ChainMove =
  | { kind: 'peek'; rung: number }
  | { kind: 'solve'; rung: number; guess: string };

// Redacted per-rung view: never includes the full answer or unrevealed letters.
export interface ChainRungView {
  revealed: number;
  shown: string; // first `revealed` letters of answer
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
}
