import { beforeAll, describe, expect, it } from 'vitest';
import { InMemoryStore, MatchService, register, type PlayerRef } from '@puzzle/core';
import { chainReaction } from '@puzzle/game-chain-reaction';

const A: PlayerRef = { playerId: 'u_alice', handle: 'Alice' };
const B: PlayerRef = { playerId: 'u_bob', handle: 'Bob' };

beforeAll(() => register(chainReaction));

function svc() {
  return new MatchService(new InMemoryStore(), { clock: () => 1000 });
}

describe('two-phone match lifecycle (create → join → play)', () => {
  it('creates a waiting match with a shareable invite code', async () => {
    const m = await svc().createMatch({ gameId: 'chain-reaction', mode: 'versus', players: [A] });
    expect(m.status).toBe('waiting');
    expect(m.view).toBeNull(); // no board until someone joins
    expect(m.inviteCode).toMatch(/^[A-Z2-9]{6}$/);
    expect(m.turn).toBeNull();
  });

  it('starts the match when the second player joins by code', async () => {
    const s = svc();
    const created = await s.createMatch({ gameId: 'chain-reaction', mode: 'versus', players: [A] });
    const joined = await s.joinMatch({ code: created.inviteCode!, player: B });

    expect(joined.status).toBe('active');
    expect(joined.view).not.toBeNull();
    expect(joined.players.map((p) => p.handle).sort()).toEqual(['Alice', 'Bob']);
    expect(joined.turn).toBe('u_alice'); // creator goes first

    // Bob's view is redacted — no full answers
    expect(JSON.stringify(joined.view)).not.toContain('"answer"');
  });

  it('lets the creator move once the match is active, and rejects moves while waiting', async () => {
    const s = svc();
    const created = await s.createMatch({ gameId: 'chain-reaction', mode: 'versus', players: [A] });

    // before anyone joins, a move is rejected
    const early = await s.applyMove({ matchId: created.matchId, playerId: 'u_alice', move: { kind: 'peek', rung: 0 } });
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.code).toBe('not_active');

    await s.joinMatch({ code: created.inviteCode!, player: B });
    const move = await s.applyMove({ matchId: created.matchId, playerId: 'u_alice', move: { kind: 'peek', rung: 0 } });
    expect(move.ok).toBe(true);
    if (move.ok) expect(move.view.turn).toBe('u_bob');
  });

  it('rejects a bad code and a full/started match', async () => {
    const s = svc();
    await expect(s.joinMatch({ code: 'NOPE12', player: B })).rejects.toThrow(/no game found/i);

    const created = await s.createMatch({ gameId: 'chain-reaction', mode: 'versus', players: [A] });
    await s.joinMatch({ code: created.inviteCode!, player: B });
    const C: PlayerRef = { playerId: 'u_carol', handle: 'Carol' };
    await expect(s.joinMatch({ code: created.inviteCode!, player: C })).rejects.toThrow(/no longer open/i);
  });

  it('is idempotent when a player re-joins their own match', async () => {
    const s = svc();
    const created = await s.createMatch({ gameId: 'chain-reaction', mode: 'versus', players: [A] });
    await s.joinMatch({ code: created.inviteCode!, player: B });
    const again = await s.joinMatch({ code: created.inviteCode!, player: B });
    expect(again.status).toBe('active');
    expect(again.players.length).toBe(2);
  });

  it('lists a match for both participants', async () => {
    const s = svc();
    const created = await s.createMatch({ gameId: 'chain-reaction', mode: 'versus', players: [A] });
    await s.joinMatch({ code: created.inviteCode!, player: B });
    expect((await s.listMatches('u_alice')).length).toBe(1);
    expect((await s.listMatches('u_bob')).length).toBe(1);
  });
});
