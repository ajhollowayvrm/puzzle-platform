// The game-module interface — the heart of the platform (CLAUDE.md §4).
// The generic core knows ONLY these types. No game-specific concepts belong here.

export type GameModel = 'shared-turn' | 'same-seed-compare';
export type GameMode = 'versus' | 'coop';
export type Metric = 'score' | 'moves' | 'timeMs';

export interface GameMeta {
  id: string; // 'chain-reaction'
  name: string; // 'Chain Reaction'
  model: GameModel;
  modes: GameMode[];
  minPlayers: number;
  maxPlayers: number;
  scoring: {
    metrics: Metric[];
    direction: Partial<Record<Metric, 'higher' | 'lower'>>;
    // primary metric first decides the winner; rest break ties in order.
    priority: Metric[];
  };
}

export interface PlayerRef {
  playerId: string;
  handle: string;
}

export interface GameEvent {
  type: string;
  // game-defined payload; the core treats events as opaque pass-through for UI
  [key: string]: unknown;
}

export interface MoveContext {
  playerId: string;
  now: number; // server timestamp (ms)
  rng: () => number; // seeded RNG; deterministic per match+seed
}

export interface ApplyResult<S> {
  state: S;
  events?: GameEvent[]; // optional, for UI animations / notifications
  error?: string; // if set, move was illegal; state MUST be unchanged
}

export interface MatchResult {
  perPlayer: Record<string, Partial<Record<Metric, number>>>;
  winnerIds: string[]; // [] while ongoing; >1 means tie
  complete: boolean;
}

export interface GameModule<S = unknown, M = unknown, View = unknown, Cfg = unknown> {
  meta: GameMeta;

  // Build initial state. For same-seed-compare, `seed` MUST fully determine the
  // puzzle so both players get an identical board.
  createState(config: Cfg, seed: string, players: PlayerRef[]): S;

  // Validate + apply. MUST be pure and deterministic given (state, move, ctx).
  // On illegal move: return { state: <unchanged>, error }.
  applyMove(state: S, move: M, ctx: MoveContext): ApplyResult<S>;

  // shared-turn only: whose turn. same-seed-compare returns null.
  currentTurn?(state: S): string | null;

  isOver(state: S): boolean;

  result(state: S): MatchResult;

  // CRITICAL: return the view a given player is allowed to see.
  // Must strip every piece of hidden info (answers, opponents' private boards).
  redact(state: S, forPlayerId: string): View;
}
