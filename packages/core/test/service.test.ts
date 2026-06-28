import { beforeAll, describe, expect, it } from 'vitest';
import { InMemoryStore, MatchService, register, type PlayerRef } from '@puzzle/core';
import { chainReaction } from '@puzzle/game-chain-reaction';

const PLAYERS: PlayerRef[] = [
  { playerId: 'p1', handle: 'P1' },
  { playerId: 'p2', handle: 'P2' },
];

beforeAll(() => {
  register(chainReaction); // fresh registry per test file (vitest isolates files)
});

function newMatch(store = new InMemoryStore(), opts = {}) {
  const svc = new MatchService(store, { clock: () => 1000, ...opts });
  return { store, svc };
}

describe('MatchService move pipeline', () => {
  it('creates a match and returns a redacted caller view', async () => {
    const { svc } = newMatch();
    const view = await svc.createMatch({
      gameId: 'chain-reaction',
      mode: 'versus',
      players: PLAYERS,
      config: { middleRungs: 2, roundsPerMatch: 1 },
    });
    expect(view.status).toBe('active');
    expect(view.turn).toBe('p1');
    expect(view.version).toBe(0);
    // the redacted view must not contain a full unsolved answer
    const json = JSON.stringify(view.view);
    expect(json).not.toContain('"answer"');
  });

  it('rejects a move from a player who is not in the match', async () => {
    const { svc } = newMatch();
    const m = await svc.createMatch({
      gameId: 'chain-reaction',
      mode: 'versus',
      players: PLAYERS,
      config: { middleRungs: 2, roundsPerMatch: 1 },
    });
    const out = await svc.applyMove({ matchId: m.matchId, playerId: 'intruder', move: { kind: 'peek', rung: 0 } });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('not_a_player');
  });

  it('enforces turn order (shared-turn)', async () => {
    const { svc } = newMatch();
    const m = await svc.createMatch({
      gameId: 'chain-reaction',
      mode: 'versus',
      players: PLAYERS,
      config: { middleRungs: 2, roundsPerMatch: 1 },
    });
    const out = await svc.applyMove({ matchId: m.matchId, playerId: 'p2', move: { kind: 'peek', rung: 0 } });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('not_your_turn');
  });

  it('does not write when the move is illegal', async () => {
    const { store, svc } = newMatch();
    const m = await svc.createMatch({
      gameId: 'chain-reaction',
      mode: 'versus',
      players: PLAYERS,
      config: { middleRungs: 2, roundsPerMatch: 1 },
    });
    const out = await svc.applyMove({ matchId: m.matchId, playerId: 'p1', move: { kind: 'peek', rung: 99 } });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('illegal_move');
    const rec = await store.getMatch(m.matchId);
    expect(rec?.version).toBe(0); // unchanged
  });

  it('applies a legal move, passes the turn, and bumps the version', async () => {
    const { store, svc } = newMatch();
    const m = await svc.createMatch({
      gameId: 'chain-reaction',
      mode: 'versus',
      players: PLAYERS,
      config: { middleRungs: 2, roundsPerMatch: 1 },
    });
    const out = await svc.applyMove({ matchId: m.matchId, playerId: 'p1', move: { kind: 'peek', rung: 0 } });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.view.turn).toBe('p2');
      expect(out.view.version).toBe(1);
    }
    const rec = await store.getMatch(m.matchId);
    expect(rec?.version).toBe(1);
    expect(rec?.turn).toBe('p2');
  });

  it('pushes redacted per-player updates to subscribers', async () => {
    const { svc } = newMatch();
    const m = await svc.createMatch({
      gameId: 'chain-reaction',
      mode: 'versus',
      players: PLAYERS,
      config: { middleRungs: 2, roundsPerMatch: 1 },
    });
    const updates: string[] = [];
    svc.subscribe(m.matchId, (u) => {
      updates.push(JSON.stringify(u.viewsByPlayer));
    });
    await svc.applyMove({ matchId: m.matchId, playerId: 'p1', move: { kind: 'peek', rung: 0 } });
    expect(updates.length).toBe(1);
    // delivered views are redacted
    expect(updates[0]).not.toContain('"answer"');
  });

  it('recovers from a concurrent write via optimistic-lock retry', async () => {
    const store = new InMemoryStore();
    let injected = 0;
    const svc = new MatchService(store, {
      clock: () => 1000,
      beforeWrite: async (match, attempt) => {
        if (attempt === 0) {
          injected++;
          // a competing writer lands first, bumping the version 0 -> 1
          await store.updateMatch(match.matchId, match.version, {
            state: match.state,
            status: match.status,
            turn: match.turn,
            updatedAt: 1,
          });
        }
      },
    });
    const m = await svc.createMatch({
      gameId: 'chain-reaction',
      mode: 'versus',
      players: PLAYERS,
      config: { middleRungs: 2, roundsPerMatch: 1 },
    });
    const out = await svc.applyMove({ matchId: m.matchId, playerId: 'p1', move: { kind: 'peek', rung: 0 } });
    expect(injected).toBe(1);
    expect(out.ok).toBe(true);
    // competing write made v1; our retried move makes v2 — no clobber, one winner.
    if (out.ok) expect(out.view.version).toBe(2);
  });
});
