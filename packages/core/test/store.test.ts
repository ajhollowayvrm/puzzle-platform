import { describe, expect, it } from 'vitest';
import { InMemoryStore, type MatchRecord } from '@puzzle/core';

function sampleMatch(): MatchRecord {
  return {
    matchId: 'm1',
    gameId: 'g',
    mode: 'versus',
    model: 'shared-turn',
    playerIds: ['p1', 'p2'],
    playerHandles: { p1: 'P1', p2: 'P2' },
    inviteCode: null,
    seed: 's',
    config: null,
    state: { n: 0 },
    version: 0,
    status: 'active',
    turn: 'p1',
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('InMemoryStore optimistic lock', () => {
  it('writes only when the expected version matches', async () => {
    const store = new InMemoryStore();
    await store.createMatch(sampleMatch());

    const v1 = await store.updateMatch('m1', 0, {
      state: { n: 1 },
      status: 'active',
      turn: 'p2',
      updatedAt: 1,
    });
    expect(v1).toBe(1);

    // stale write at version 0 must be rejected
    const stale = await store.updateMatch('m1', 0, {
      state: { n: 99 },
      status: 'active',
      turn: 'p1',
      updatedAt: 2,
    });
    expect(stale).toBeNull();

    const cur = await store.getMatch('m1');
    expect(cur?.version).toBe(1);
    expect(cur?.state).toEqual({ n: 1 }); // not clobbered
  });

  it('isolates stored state from the caller (no shared references)', async () => {
    const store = new InMemoryStore();
    const m = sampleMatch();
    await store.createMatch(m);
    (m.state as { n: number }).n = 123; // mutate caller copy after write
    const cur = await store.getMatch('m1');
    expect((cur?.state as { n: number }).n).toBe(0);
  });
});
