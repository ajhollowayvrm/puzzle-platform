import { describe, expect, it } from 'vitest';
import { makeRng } from '@puzzle/core';
import { chainReaction, type ChainState, type ChainView } from '@puzzle/game-chain-reaction';

const PLAYERS = [
  { playerId: 'p1', handle: 'P1' },
  { playerId: 'p2', handle: 'P2' },
];

function ctx(playerId: string) {
  return { playerId, now: 1, rng: makeRng('redact') };
}

describe('Chain Reaction redaction (mandatory security gate §10)', () => {
  it('never leaks a full unsolved answer to either player', () => {
    let state: ChainState = chainReaction.createState(
      { middleRungs: 3, roundsPerMatch: 1 },
      'redact-seed',
      PLAYERS,
    );

    // peek a couple of letters on a couple of rungs so some are partially revealed
    state = chainReaction.applyMove(state, { kind: 'peek', rung: 0 }, ctx(state.turn)).state;
    state = chainReaction.applyMove(state, { kind: 'peek', rung: 0 }, ctx(state.turn)).state;
    state = chainReaction.applyMove(state, { kind: 'peek', rung: 1 }, ctx(state.turn)).state;

    const answers = state.rungs.map((r) => r.answer);

    for (const p of PLAYERS) {
      const view = chainReaction.redact(state, p.playerId) as ChainView;
      const json = JSON.stringify(view);

      view.rungs.forEach((rv, i) => {
        if (rv.solvedBy === null) {
          const answer = answers[i]!;
          // the shown prefix matches exactly the revealed count, nothing more
          expect(rv.shown).toBe(answer.slice(0, rv.revealed));
          expect(rv.shown.length).toBe(rv.revealed);
          expect(rv.revealed).toBeLessThan(answer.length);
          // the full answer must appear nowhere in the serialized view
          expect(json).not.toContain(answer);
        }
      });
    }
  });

  it('reveals the full word only once a rung is solved', () => {
    let state: ChainState = chainReaction.createState(
      { middleRungs: 2, roundsPerMatch: 1 },
      'solve-seed',
      PLAYERS,
    );
    const answer0 = state.rungs[0]!.answer;
    state = chainReaction.applyMove(
      state,
      { kind: 'solve', rung: 0, guess: answer0 },
      ctx(state.turn),
    ).state;

    const view = chainReaction.redact(state, 'p1') as ChainView;
    expect(view.rungs[0]!.solvedBy).not.toBeNull();
    expect(view.rungs[0]!.shown).toBe(answer0); // solved → full word is fine
  });
});
