// MatchService — the generic, game-agnostic core (CLAUDE.md §5).
// The ONLY write path is applyMove(), implementing the §5 move pipeline.
// Knows nothing about any specific game; everything game-specific comes from a
// registered GameModule.

import { getModule } from './registry.js';
import { makeRng } from './rng.js';
import { newId, newSeed, newCode } from './ids.js';
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
  players: PlayerRef[]; // 1 player → waiting for a join; full roster → starts now
  config?: unknown;
  seed?: string;
  // undefined → auto-generate a code when the match isn't full; null → no code (local).
  inviteCode?: string | null;
}

export interface MatchView {
  matchId: string;
  gameId: string;
  mode: GameMode;
  status: MatchStatus;
  turn: string | null;
  version: number;
  view: unknown; // redacted for the requesting player; null while waiting
  result: MatchResult;
  players: PlayerRef[];
  inviteCode: string | null; // share this so a second player can join
}

export type MoveOutcome =
  | { ok: true; view: MatchView } // redacted view for the caller
  | { ok: false; code: MoveErrorCode; error: string };

export type MoveErrorCode =
  | 'not_found'
  | 'not_a_player'
  | 'not_your_turn'
  | 'not_active'
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
    if (input.players.length < 1 || input.players.length > meta.maxPlayers) {
      throw new Error(
        `game ${meta.id} accepts 1-${meta.maxPlayers} players at creation, got ${input.players.length}`,
      );
    }

    const now = this.clock();
    const seed = input.seed ?? newSeed();
    const players = input.players;
    const playerHandles: Record<string, string> = {};
    for (const p of players) playerHandles[p.playerId] = p.handle;

    // generate a join code unless the match is already full, or the caller opted out
    const inviteCode =
      input.inviteCode !== undefined
        ? input.inviteCode
        : players.length < meta.maxPlayers
          ? newCode()
          : null;

    // Build state only once enough players are present; otherwise wait for a join.
    const started = this.startState(module, input.config, seed, players);

    const record: MatchRecord = {
      matchId: newId('m_'),
      gameId: meta.id,
      mode: input.mode,
      model: meta.model,
      playerIds: players.map((p) => p.playerId),
      playerHandles,
      inviteCode,
      seed,
      config: input.config ?? null,
      state: started.state,
      version: 0,
      status: started.status,
      turn: started.turn,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.createMatch(record);
    return this.viewOf(record, players, players[0]!.playerId);
  }

  // A second player joins a waiting match via its invite code. When the roster
  // reaches minPlayers, the board is built and the match goes active.
  async joinMatch(args: { code: string; player: PlayerRef }): Promise<MatchView> {
    for (let attempt = 0; attempt <= this.maxWriteRetries; attempt++) {
      const match = await this.store.getMatchByCode(args.code);
      if (!match) throw new Error('no game found for that code');
      const module = getModule(match.gameId);

      // idempotent: re-joining your own match just returns your view
      if (match.playerIds.includes(args.player.playerId)) {
        return this.viewOf(match, this.playerRefsOf(match), args.player.playerId);
      }
      if (match.status !== 'waiting' || match.playerIds.length >= module.meta.maxPlayers) {
        throw new Error('that game is no longer open to join');
      }

      const playerIds = [...match.playerIds, args.player.playerId];
      const playerHandles = { ...match.playerHandles, [args.player.playerId]: args.player.handle };
      const players: PlayerRef[] = playerIds.map((id) => ({ playerId: id, handle: playerHandles[id] ?? id }));
      const started = this.startState(module, match.config, match.seed, players);

      const newVersion = await this.store.updateMatch(match.matchId, match.version, {
        playerIds,
        playerHandles,
        state: started.state,
        status: started.status,
        turn: started.turn,
        updatedAt: this.clock(),
      });
      if (newVersion === null) continue; // lost a race — reload and retry

      const written: MatchRecord = {
        ...match,
        playerIds,
        playerHandles,
        state: started.state,
        status: started.status,
        turn: started.turn,
        version: newVersion,
      };
      this.deliver(written, players, []);
      return this.viewOf(written, players, args.player.playerId);
    }
    throw new Error('could not join right now, please retry');
  }

  // Build initial state once minPlayers are present, else stay waiting.
  private startState(
    module: ReturnType<typeof getModule>,
    config: unknown,
    seed: string,
    players: PlayerRef[],
  ): { state: unknown; status: MatchStatus; turn: string | null } {
    if (players.length < module.meta.minPlayers) {
      return { state: null, status: 'waiting', turn: null };
    }
    const state = module.createState(config, seed, players);
    const turn = module.currentTurn ? module.currentTurn(state) : null;
    const status: MatchStatus = module.isOver(state) ? 'complete' : 'active';
    return { state, status, turn };
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
      if (match.status !== 'active' || match.state == null) {
        return { ok: false, code: 'not_active', error: 'match has not started yet' };
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
    const live = m.status !== 'waiting' && m.state != null;
    return {
      matchId: m.matchId,
      gameId: m.gameId,
      mode: m.mode,
      status: m.status,
      turn: m.turn,
      version: m.version,
      view: live ? module.redact(m.state, forPlayerId) : null,
      result: live ? module.result(m.state) : { perPlayer: {}, winnerIds: [], complete: false },
      players,
      inviteCode: m.inviteCode,
    };
  }

  private playerRefsOf(m: MatchRecord): PlayerRef[] {
    return m.playerIds.map((playerId) => ({
      playerId,
      handle: m.playerHandles?.[playerId] ?? playerId,
    }));
  }
}
