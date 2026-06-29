// Per-game UI adapter. The app shell (home / lobby / match navigation) is fully
// game-agnostic; everything game-specific — config knobs, board rendering, the
// one-line match summary, event narration — lives behind this interface, keyed by
// gameId. Adding a second game = registering its module + one adapter here.
import type { MatchView } from '@puzzle/core';

export interface Knob {
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
}

export interface RenderCtx {
  handleOf: (id: string) => string;
  selectedRung: number | null;
}

export interface GameUI {
  knobs: Knob[];
  // a single player's panel, rendered from that player's REDACTED view
  renderPanel(mv: MatchView, playerId: string, ctx: RenderCtx): string;
  // one-line summary for the "your games" list / continue button
  summary(mv: MatchView, handleOf: (id: string) => string): string;
  // narrate the events of the latest move for the status line
  describeEvents(events: unknown[], handleOf: (id: string) => string): string;
}
