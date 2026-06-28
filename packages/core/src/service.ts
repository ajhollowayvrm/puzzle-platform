// MatchService — the generic, game-agnostic core (CLAUDE.md §5).
// The ONLY write path is applyMove(), implementing the §5 move pipeline.
// Knows nothing about any specific game; everything game-specific comes from a
// registered GameModule.

import { getModule } from './registry.js';
import { makeRng } from './rng.js';
import { newId, newSeed } from './ids.js';
import type { Store, MatchRecord, MatchStatus } from './store.js';
import type {
  GameMode,
  MatchResult,
  MoveContext,
  PlayerRef,
} from './types.js';

export interface CreateMatchInput {
  gameId: string;
  mode: GameMode;
  players: PlayerRef[];
  config?: unknown;
  seed?: string;
}

export interface MatchView {
  matchId: string;
  gameId: string;
  mode: GameMode;
  status: MatchStatus;
  turn: string | null;
  version: number;
  view: unknown; // redacted for the requesting player
  result: MatchResult;
  players: PlayerRef[];
}

export type MoveOutcome =
  | { ok: true; view: MatchView } // redacted view for the caller
  | { ok: false; code: MoveErrorCode; error: string };

export type MoveErrorCode =
  | 'not_found'
  | 'not_a_player'
  | 'not_your_turn'
  | 'match_complete'
  | 'illegal_move'
  | 'conflict';

// Live delivery: a successful move pushes a per-player redacted view to every
// subscriber for that match. Phase 2 replaces these listeners with WebSocket
// pushes; offline players get a notification + re-read on next open (Phase 3).
export interface MatchUpdate {
  matchId: string;
  version: number;
  status: MatchStatus;
  turn: string | null;
  // playerId -> that player's redacted MatchView
  viewsByPlayer: Record<string, MatchView>;
  events: unknown[];
}
type Listener = (u: MatchUpdate) => void;

export interface MatchServiceOptions {
  clock?: () => number; // server timestamp source (default Date.now)
  maxWriteRetries?: number; // optimistic-lock retries (default 4)
  // Test seam: invoked once per write attempt, after load + applyMove, before the
  // conditional write. Lets tests inject a competing write to exercise the retry.
  beforeWrite?: (match: MatchRecord, attempt: number) => Promise<void> | void;
}

export class MatchService {
  private readonly store: Store;
  private readonly clock: () => number;
  private readonly maxWriteRetries: number;
  private readonly beforeWrite?: (m: MatchRecord, attempt: number) => Promise<void> | void;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(store: Store, opts: MatchServiceOptions = {}) {
    this.store = store;
    this.clock = opts.clock ?? (() => Date.now());
    this.maxWriteRetries = opts.maxWriteRetries ?? 4;
    if (opts.beforeWrite) this.beforeWrite = opts.beforeWrite;
  }

  // --- match lifecycle ---

  async createMatch(input: CreateMatchInput): Promise<MatchView> {
    const module = getModule(input.gameId);
    const { meta } = module;

    if (!meta.modes.includes(input.mode)) {
      throw new Error(`game ${meta.id} does not support mode ${input.mode}`);
    }
    if (input.players.length < meta.minPlayers || input.players.length > meta.maxPlayers) {
      throw new Error(
        `game ${meta.id} needs ${meta.minPlayers}-${meta.maxPlayers} players, got ${input.players.length}`,
      );
    }

    const now = this.clock();
    const seed = input.seed ?? newSeed();
    const state = module.createState(input.config, seed, input.players);
    const turn = module.currentTurn ? module.currentTurn(state) : null;
    const status: MatchStatus = module.isOver(state) ? 'complete' : 'active';

    const record: MatchRecord = {
      matchId: newId('m_'),
      gameId: meta.id,
      mode: input.mode,
      model: meta.model,
      playerIds: input.players.map((p) => p.playerId),
      seed,
      config: input.config ?? null,
      state,
      version: 0,
      status,
      turn,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.createMatch(record);
    return this.viewOf(record, input.players, input.players[0]!.playerId);
  }

  async getMatchView(matchId: string, forPlayerId: string): Promise<MatchView | null> {
    const m = await this.store.getMatch(matchId);
    if (!m) return null;
    return this.viewOf(m, this.playerRefsOf(m), forPlayerId);
  }

  async listMatches(userId: string): Promise<MatchView[]> {
    const matches = await this.store.listMatchesForUser(userId);
    return matches.map((m) => this.viewOf(m, this.playerRefsOf(m), userId));
  }

  // --- the move pipeline (§5): the only write path ---

  async applyMove(args: {
    matchId: string;
    playerId: string;
    move: unknown;
  }): Promise<MoveOutcome> {
    for (let attempt = 0; attempt <= this.maxWriteRetries; attempt++) {
      // 1. load Match by id
      const match = await this.store.getMatch(args.matchId);
      if (!match) return { ok: false, code: 'not_found', error: 'match not found' };

      // 2. load module by Match.gameId
      const module = getModule(match.gameId);

      // 3. auth: is this player in the match? (shared-turn: is it their turn?)
      if (!match.playerIds.includes(args.playerId)) {
        return { ok: false, code: 'not_a_player', error: 'you are not in this match' };
      }
      if (match.status === 'complete') {
        return { ok: false, code: 'match_complete', error: 'match is already complete' };
      }
      if (match.model === 'shared-turn' && module.currentTurn) {
        const whose = module.currentTurn(match.state);
        if (whose !== args.playerId) {
          return { ok: false, code: 'not_your_turn', error: 'it is not your turn' };
        }
      }

      // 4. build deterministic MoveContext (no clock/RNG leakage into the module)
      const ctx: MoveContext = {
        playerId: args.playerId,
        now: this.clock(),
        rng: makeRng(`${match.seed}#${match.version}`),
      };

      // 5. applyMove (pure)
      const res = module.applyMove(match.state, args.move, ctx);

      // 6. if error: return 4xx, do NOT write
      if (res.error) {
        return { ok: false, code: 'illegal_move', error: res.error };
      }

      const turn = module.currentTurn ? module.currentTurn(res.state) : null;
      const status: MatchStatus = module.isOver(res.state) ? 'complete' : match.status;

      // test seam: simulate a concurrent writer landing before our write
      if (this.beforeWrite) await this.beforeWrite(match, attempt);

      // 7. conditional write guarded by Match.version (optimistic lock)
      const newVersion = await this.store.updateMatch(args.matchId, match.version, {
        state: res.state,
        status,
        turn,
        updatedAt: this.clock(),
      });

      if (newVersion === null) {
        // someone else wrote first — reload and retry the whole pipeline cleanly
        continue;
      }

      // 8. deliver redact(newState, p) to every player (live push here)
      const players = this.playerRefsOf(match);
      const written: MatchRecord = {
        ...match,
        state: res.state,
        status,
        turn,
        version: newVersion,
      };
      this.deliver(written, players, res.events ?? []);

      // 9. return redact(newState, caller) to the caller
      return { ok: true, view: this.viewOf(written, players, args.playerId) };
    }

    return {
      ok: false,
      code: 'conflict',
      error: 'too many concurrent writes; please retry',
    };
  }

  // --- live delivery ---

  subscribe(matchId: string, listener: Listener): () => void {
    let set = this.listeners.get(matchId);
    if (!set) {
      set = new Set();
      this.listeners.set(matchId, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(matchId);
    };
  }

  private deliver(match: MatchRecord, players: PlayerRef[], events: unknown[]): void {
    const set = this.listeners.get(match.matchId);
    if (!set || set.size === 0) return;
    const viewsByPlayer: Record<string, MatchView> = {};
    for (const p of players) {
      viewsByPlayer[p.playerId] = this.viewOf(match, players, p.playerId);
    }
    const update: MatchUpdate = {
      matchId: match.matchId,
      version: match.version,
      status: match.status,
      turn: match.turn,
      viewsByPlayer,
      events,
    };
    for (const l of set) l(update);
  }

  // --- helpers ---

  private viewOf(m: MatchRecord, players: PlayerRef[], forPlayerId: string): MatchView {
    const module = getModule(m.gameId);
    return {
      matchId: m.matchId,
      gameId: m.gameId,
      mode: m.mode,
      status: m.status,
      turn: m.turn,
      version: m.version,
      view: module.redact(m.state, forPlayerId),
      result: module.result(m.state),
      players,
    };
  }

  // Phase 1 stores no handles on the match record; reconstruct minimal PlayerRefs.
  // Phase 2 will join against the Users table for real handles.
  private playerRefsOf(m: MatchRecord): PlayerRef[] {
    return m.playerIds.map((playerId) => ({ playerId, handle: playerId }));
  }
}
