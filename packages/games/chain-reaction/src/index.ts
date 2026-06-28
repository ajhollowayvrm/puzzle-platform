// Chain Reaction — game module #1 (CLAUDE.md §7). model: 'shared-turn'.
// applyMove is pure/deterministic: no Date.now / Math.random — only ctx.
import { makeRng } from '@puzzle/core';
import type {
  ApplyResult,
  GameEvent,
  GameMeta,
  GameModule,
  MatchResult,
  MoveContext,
  PlayerRef,
} from '@puzzle/core';
import packV1 from './pack.v1.json';
import {
  DEFAULT_CHAIN_CONFIG,
  type ChainConfig,
  type ChainMove,
  type ChainRung,
  type ChainState,
  type ChainView,
} from './types.js';

export * from './types.js';

interface PackChain {
  words: string[];
  links: string[];
}
const CHAINS = packV1.chains as PackChain[];

export const meta: GameMeta = {
  id: 'chain-reaction',
  name: 'Chain Reaction',
  model: 'shared-turn',
  modes: ['versus'],
  minPlayers: 2,
  maxPlayers: 2,
  scoring: {
    metrics: ['score'],
    direction: { score: 'higher' },
    priority: ['score'],
  },
};

// ---- helpers ----

function mergeConfig(config: unknown): ChainConfig {
  const c = (config ?? {}) as Partial<ChainConfig>;
  const merged: ChainConfig = { ...DEFAULT_CHAIN_CONFIG };
  for (const k of Object.keys(DEFAULT_CHAIN_CONFIG) as (keyof ChainConfig)[]) {
    const v = c[k];
    if (typeof v === 'number' && Number.isFinite(v)) merged[k] = v;
  }
  merged.middleRungs = Math.max(1, Math.floor(merged.middleRungs));
  merged.roundsPerMatch = Math.max(1, Math.floor(merged.roundsPerMatch));
  return merged;
}

// Deterministically pick a chain whose interior length matches middleRungs,
// falling back to the whole bank if none match.
function pickChain(rng: () => number, middleRungs: number): PackChain {
  const want = CHAINS.filter((c) => c.words.length - 2 === middleRungs);
  const pool = want.length > 0 ? want : CHAINS;
  const chain = pool[Math.floor(rng() * pool.length)];
  if (!chain) throw new Error('chain-reaction: puzzle pack is empty');
  return chain;
}

// Build the board for a given round (start/end/rungs/scores/turn).
function buildRound(
  config: ChainConfig,
  seed: string,
  order: string[],
  round: number,
): Pick<ChainState, 'start' | 'end' | 'rungs' | 'scores' | 'turn'> {
  const rng = makeRng(`${seed}#round${round}`);
  const chain = pickChain(rng, config.middleRungs);
  const words = chain.words.map((w) => w.toUpperCase());
  const start = words[0]!;
  const end = words[words.length - 1]!;
  const interior = words.slice(1, -1);
  const rungs: ChainRung[] = interior.map((answer) => ({
    answer,
    revealed: 0,
    value: config.startingValue,
    solvedBy: null,
  }));
  const scores: Record<string, number> = {};
  for (const id of order) scores[id] = 0;
  // Alternate the starting player each round for fairness.
  const turn = order[round % order.length]!;
  return { start, end, rungs, scores, turn };
}

function nextTurn(order: string[], current: string): string {
  const i = order.indexOf(current);
  return order[(i + 1) % order.length]!;
}

function normalizeGuess(guess: string): string {
  return guess.trim().toUpperCase().replace(/\s+/g, '');
}

// Highest round score wins the round; a tie awards no one (returns null).
function roundWinner(scores: Record<string, number>, order: string[]): string | null {
  let best = -Infinity;
  let winner: string | null = null;
  let tied = false;
  for (const id of order) {
    const s = scores[id] ?? 0;
    if (s > best) {
      best = s;
      winner = id;
      tied = false;
    } else if (s === best) {
      tied = true;
    }
  }
  return tied ? null : winner;
}

// ---- the module ----

export const chainReaction: GameModule<ChainState, ChainMove, ChainView, Partial<ChainConfig>> = {
  meta,

  createState(config, seed, players: PlayerRef[]): ChainState {
    const cfg = mergeConfig(config);
    const order = players.map((p) => p.playerId);
    const roundWins: Record<string, number> = {};
    for (const id of order) roundWins[id] = 0;
    const round0 = buildRound(cfg, seed, order, 0);
    return {
      config: cfg,
      seed,
      order,
      round: 0,
      roundWins,
      matchOver: false,
      ...round0,
    };
  },

  applyMove(state, move, ctx: MoveContext): ApplyResult<ChainState> {
    if (state.matchOver) return { state, error: 'match is over' };
    if (!move || typeof move !== 'object') return { state, error: 'invalid move' };
    if (state.turn !== ctx.playerId) return { state, error: 'it is not your turn' };

    const idx = (move as ChainMove).rung;
    if (!Number.isInteger(idx) || idx < 0 || idx >= state.rungs.length) {
      return { state, error: 'no such rung' };
    }
    const target = state.rungs[idx]!;
    if (target.solvedBy !== null) return { state, error: 'that rung is already solved' };

    const { config, order } = state;
    const next = structuredClone(state);
    const rung = next.rungs[idx]!;
    const events: GameEvent[] = [];

    if (move.kind === 'peek') {
      rung.revealed = Math.min(rung.revealed + 1, rung.answer.length);
      rung.value = Math.max(config.valueFloor, rung.value - config.peekPenalty);
      events.push({ type: 'peek', rung: idx, by: ctx.playerId });
    } else if (move.kind === 'solve') {
      if (typeof move.guess !== 'string' || move.guess.trim() === '') {
        return { state, error: 'empty guess' };
      }
      if (normalizeGuess(move.guess) === rung.answer) {
        rung.solvedBy = ctx.playerId;
        rung.revealed = rung.answer.length;
        next.scores[ctx.playerId] = (next.scores[ctx.playerId] ?? 0) + rung.value;
        events.push({ type: 'solved', rung: idx, by: ctx.playerId, value: rung.value });
      } else {
        // wrong: leak penalty, identical to a peek the opponent didn't pay for.
        rung.revealed = Math.min(rung.revealed + 1, rung.answer.length);
        rung.value = Math.max(config.valueFloor, rung.value - config.peekPenalty);
        events.push({ type: 'wrong', rung: idx, by: ctx.playerId });
      }
    } else {
      return { state, error: 'unknown action' };
    }

    // every action passes the turn (strict alternation)
    next.turn = nextTurn(order, ctx.playerId);

    // round over? all rungs solved
    if (next.rungs.every((r) => r.solvedBy !== null)) {
      const winner = roundWinner(next.scores, order);
      if (winner) next.roundWins[winner] = (next.roundWins[winner] ?? 0) + 1;
      events.push({
        type: 'roundOver',
        round: next.round,
        winner,
        scores: { ...next.scores },
        chain: [next.start, ...next.rungs.map((r) => r.answer), next.end],
      });

      if (next.round + 1 < config.roundsPerMatch) {
        const nextRound = buildRound(config, next.seed, order, next.round + 1);
        next.round += 1;
        next.start = nextRound.start;
        next.end = nextRound.end;
        next.rungs = nextRound.rungs;
        next.scores = nextRound.scores;
        next.turn = nextRound.turn;
      } else {
        next.matchOver = true;
        events.push({ type: 'matchOver', roundWins: { ...next.roundWins } });
      }
    }

    return { state: next, events };
  },

  currentTurn(state): string | null {
    return state.matchOver ? null : state.turn;
  },

  isOver(state): boolean {
    return state.matchOver;
  },

  result(state): MatchResult {
    const perPlayer: MatchResult['perPlayer'] = {};
    for (const id of state.order) perPlayer[id] = { score: state.roundWins[id] ?? 0 };
    let winnerIds: string[] = [];
    if (state.matchOver) {
      let best = -Infinity;
      for (const id of state.order) best = Math.max(best, state.roundWins[id] ?? 0);
      winnerIds = state.order.filter((id) => (state.roundWins[id] ?? 0) === best);
    }
    return { perPlayer, winnerIds, complete: state.matchOver };
  },

  // Security boundary (§7): never emit a full unsolved answer or its hidden letters.
  redact(state, _forPlayerId): ChainView {
    return {
      start: state.start,
      end: state.end,
      rungs: state.rungs.map((r): ChainView['rungs'][number] => {
        const solved = r.solvedBy !== null;
        return {
          revealed: solved ? r.answer.length : r.revealed,
          shown: solved ? r.answer : r.answer.slice(0, r.revealed),
          length: r.answer.length,
          value: r.value,
          solvedBy: r.solvedBy,
        };
      }),
      scores: { ...state.scores },
      turn: state.turn,
      order: [...state.order],
      round: state.round,
      roundsPerMatch: state.config.roundsPerMatch,
      roundWins: { ...state.roundWins },
      matchOver: state.matchOver,
    };
  },
};

export default chainReaction;
