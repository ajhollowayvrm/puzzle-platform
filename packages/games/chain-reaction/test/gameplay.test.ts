import { describe, expect, it } from 'vitest';
import { makeRng } from '@puzzle/core';
import { chainReaction, type ChainMove, type ChainState } from '@puzzle/game-chain-reaction';

const PLAYERS = [
  { playerId: 'p1', handle: 'P1' },
  { playerId: 'p2', handle: 'P2' },
];

const ctx = (playerId: string) => ({ playerId, now: 1, rng: makeRng('g') });

// drive one legal move by whoever's turn it currently is
function step(state: ChainState, move: ChainMove): ChainState {
  const res = chainReaction.applyMove(state, move, ctx(state.turn));
  expect(res.error).toBeUndefined();
  return res.state;
}

function fresh(config: Partial<ConstructorConfig> = {}): ChainState {
  return chainReaction.createState(
    { middleRungs: 2, roundsPerMatch: 1, ...config },
    'play-seed',
    PLAYERS,
  );
}
type ConstructorConfig = {
  startingValue: number;
  peekPenalty: number;
  valueFloor: number;
  middleRungs: number;
  roundsPerMatch: number;
};

describe('Chain Reaction gameplay (§7)', () => {
  it('peek lowers the pot and passes the turn', () => {
    const s0 = fresh();
    const startVal = s0.rungs[0]!.value;
    const s1 = step(s0, { kind: 'peek', rung: 0 });
    expect(s1.rungs[0]!.revealed).toBe(1);
    expect(s1.rungs[0]!.value).toBe(startVal - s0.config.peekPenalty);
    expect(s1.turn).toBe('p2');
    // original state untouched (purity)
    expect(s0.rungs[0]!.revealed).toBe(0);
  });

  it('a correct solve banks the current pot to the solver', () => {
    const s0 = fresh();
    const ans = s0.rungs[0]!.answer;
    const s1 = step(s0, { kind: 'solve', rung: 0, guess: ans.toLowerCase() }); // case-insensitive
    expect(s1.rungs[0]!.solvedBy).toBe('p1');
    expect(s1.scores['p1']).toBe(s0.config.startingValue);
    expect(s1.turn).toBe('p2');
  });

  it('a wrong solve applies the leak penalty and passes the turn', () => {
    const s0 = fresh();
    const startVal = s0.rungs[0]!.value;
    const s1 = step(s0, { kind: 'solve', rung: 0, guess: 'definitelywrong' });
    expect(s1.rungs[0]!.solvedBy).toBeNull();
    expect(s1.rungs[0]!.revealed).toBe(1);
    expect(s1.rungs[0]!.value).toBe(startVal - s0.config.peekPenalty);
    expect(s1.turn).toBe('p2');
  });

  it('respects the value floor', () => {
    const s0 = fresh({ startingValue: 4, peekPenalty: 2, valueFloor: 2 });
    let s = step(s0, { kind: 'peek', rung: 0 }); // 4 -> 2
    s = step(s, { kind: 'peek', rung: 0 }); // floor at 2 (was p2's turn now)
    expect(s.rungs[0]!.value).toBe(2);
  });

  it('completes a single-round match and names the winner', () => {
    // Deterministic non-tie: p1 peeks rung0 (lowering its pot), so when p2 banks
    // rung0 and p1 banks rung1 at full value, p1 finishes ahead.
    let s = fresh({ roundsPerMatch: 1, startingValue: 10, peekPenalty: 2 });
    s = step(s, { kind: 'peek', rung: 0 }); // p1 peeks; rung0 pot 10 -> 8, turn p2
    s = step(s, { kind: 'solve', rung: 0, guess: s.rungs[0]!.answer }); // p2 banks 8
    s = step(s, { kind: 'solve', rung: 1, guess: s.rungs[1]!.answer }); // p1 banks 10
    expect(chainReaction.isOver(s)).toBe(true);
    const result = chainReaction.result(s);
    expect(result.complete).toBe(true);
    expect(result.winnerIds).toEqual(['p1']);
    expect(s.roundWins['p1']).toBe(1);
    expect(s.roundWins['p2']).toBe(0);
  });

  it('a perfectly even round (no peeks) ties and awards no round win', () => {
    // documents the tuning reality: equal play with banker scoring ties.
    let s = fresh({ roundsPerMatch: 1 });
    while (!s.matchOver) {
      const i = s.rungs.findIndex((r) => r.solvedBy === null);
      s = step(s, { kind: 'solve', rung: i, guess: s.rungs[i]!.answer });
    }
    const totalWins = Object.values(s.roundWins).reduce((a, b) => a + b, 0);
    expect(totalWins).toBe(0); // tie -> nobody banks a round win
  });

  it('advances to a new round with a reset board (best-of-N)', () => {
    let s = fresh({ roundsPerMatch: 2 });
    expect(s.round).toBe(0);
    // finish round 0
    let i = s.rungs.findIndex((r) => r.solvedBy === null);
    while (i !== -1 && s.round === 0) {
      s = step(s, { kind: 'solve', rung: i, guess: s.rungs[i]!.answer });
      i = s.rungs.findIndex((r) => r.solvedBy === null);
    }
    expect(s.round).toBe(1);
    expect(s.matchOver).toBe(false);
    expect(s.rungs.every((r) => r.solvedBy === null)).toBe(true);
    expect(Object.values(s.scores).every((v) => v === 0)).toBe(true);
  });

  it('rejects a move once the match is over', () => {
    let s = fresh({ roundsPerMatch: 1 });
    while (!s.matchOver) {
      const i = s.rungs.findIndex((r) => r.solvedBy === null);
      s = step(s, { kind: 'solve', rung: i, guess: s.rungs[i]!.answer });
    }
    const res = chainReaction.applyMove(s, { kind: 'peek', rung: 0 }, ctx(s.order[0]!));
    expect(res.error).toBeTruthy();
    expect(res.state).toBe(s); // unchanged
  });
});
