import { describe, it } from 'vitest';
import { assertConformance } from '@puzzle/core/testkit';
import { chainReaction, type ChainMove } from '@puzzle/game-chain-reaction';

describe('Chain Reaction interface conformance (§10)', () => {
  it('passes the shared GameModule conformance suite', () => {
    assertConformance(chainReaction, {
      config: { middleRungs: 3, roundsPerMatch: 2 },
      seed: 'conformance-seed',
      players: [
        { playerId: 'p1', handle: 'P1' },
        { playerId: 'p2', handle: 'P2' },
      ],
      legalMove: (): ChainMove => ({ kind: 'peek', rung: 0 }),
      illegalMove: (): ChainMove => ({ kind: 'peek', rung: 999 }),
    });
  });
});
