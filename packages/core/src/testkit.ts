// Shared interface-conformance suite (CLAUDE.md §10). Every GameModule must pass
// it. Implemented as framework-agnostic functions that throw on failure, so a game
// package wraps them in its own vitest `it(...)` without core depending on vitest.

import { makeRng } from './rng.js';
import type { GameModule, MoveContext, PlayerRef } from './types.js';

export interface ConformanceFixture<S, M, Cfg> {
  config: Cfg;
  seed: string;
  players: PlayerRef[];
  // A move that is legal from the initial state, by the player whose turn it is.
  legalMove: (state: S) => M;
  // A move that must be rejected from the initial state (illegal/out-of-range).
  illegalMove: (state: S) => M;
}

function ctxFor<S>(module: GameModule<S>, state: S, seed: string, now = 1000): MoveContext {
  const playerId = module.currentTurn?.(state) ?? 'p1';
  return { playerId: playerId ?? 'p1', now, rng: makeRng(`${seed}#ctx`) };
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`conformance: ${msg}`);
}

// Run all conformance checks. Throws the first violation found.
export function assertConformance<S, M, View, Cfg>(
  module: GameModule<S, M, View, Cfg>,
  fx: ConformanceFixture<S, M, Cfg>,
): void {
  const { config, seed, players } = fx;

  // createState is deterministic given (config, seed, players).
  const a = module.createState(config, seed, players);
  const b = module.createState(config, seed, players);
  assert(
    JSON.stringify(a) === JSON.stringify(b),
    'createState must be deterministic for the same (config, seed, players)',
  );

  // meta sanity
  assert(module.meta.scoring.priority.length !== 0, 'meta.scoring.priority should be non-empty');
  for (const m of module.meta.scoring.priority) {
    assert(
      module.meta.scoring.metrics.includes(m),
      `priority metric ${m} must be declared in metrics`,
    );
  }
  if (module.meta.model === 'shared-turn') {
    assert(typeof module.currentTurn === 'function', 'shared-turn games must implement currentTurn');
  }

  // applyMove purity: same (state, move, ctx) => identical result, no mutation.
  const state0 = module.createState(config, seed, players);
  const snapshot = JSON.stringify(state0);
  const move = fx.legalMove(state0);
  const ctx = ctxFor(module, state0, seed);
  const r1 = module.applyMove(state0, move, ctx);
  const r2 = module.applyMove(state0, move, ctx);
  assert(
    JSON.stringify(state0) === snapshot,
    'applyMove must not mutate the input state',
  );
  assert(
    JSON.stringify(r1.state) === JSON.stringify(r2.state),
    'applyMove must be pure/deterministic given identical (state, move, ctx)',
  );
  assert(!r1.error, 'the fixture legalMove must be accepted from the initial state');

  // illegal move: state unchanged + error set.
  const state1 = module.createState(config, seed, players);
  const before = JSON.stringify(state1);
  const bad = module.applyMove(state1, fx.illegalMove(state1), ctxFor(module, state1, seed));
  assert(!!bad.error, 'an illegal move must return an error');
  assert(
    JSON.stringify(bad.state) === before,
    'an illegal move must leave state unchanged',
  );

  // isOver / result consistency.
  const fresh = module.createState(config, seed, players);
  const res = module.result(fresh);
  assert(res.complete === module.isOver(fresh), 'result.complete must agree with isOver');
  if (!module.isOver(fresh)) {
    assert(res.winnerIds.length === 0, 'winnerIds must be empty while the match is ongoing');
  }
}
