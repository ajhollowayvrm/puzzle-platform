import { describe, expect, it } from 'vitest';
import { chainReaction, type ChainState } from '@puzzle/game-chain-reaction';
import { LINKS } from '../src/links.js';

const PLAYERS = [
  { playerId: 'p1', handle: 'P1' },
  { playerId: 'p2', handle: 'P2' },
];
const LINK_SET = new Set(LINKS.map(([a, b]) => `${a}|${b}`));

function words(s: ChainState): string[] {
  return [s.start, ...s.rungs.map((r) => r.answer), s.end].map((w) => w.toLowerCase());
}

describe('Chain Reaction word-graph generator', () => {
  it('builds long chains where every adjacent pair is a real compound', () => {
    const s = chainReaction.createState({ middleRungs: 8, roundsPerMatch: 1 }, 'long-seed', PLAYERS);
    expect(s.rungs.length).toBeGreaterThanOrEqual(6); // long chains are reachable
    const w = words(s);
    for (let i = 0; i < w.length - 1; i++) {
      expect(LINK_SET.has(`${w[i]}|${w[i + 1]}`), `${w[i]} → ${w[i + 1]} must be a verified link`).toBe(true);
    }
    expect(new Set(w).size).toBe(w.length); // no repeated words
  });

  it('is deterministic for the same seed', () => {
    const a = chainReaction.createState({ middleRungs: 5 }, 'same', PLAYERS);
    const b = chainReaction.createState({ middleRungs: 5 }, 'same', PLAYERS);
    expect(words(a)).toEqual(words(b));
  });

  it('honors small rung counts exactly', () => {
    const s = chainReaction.createState({ middleRungs: 2, roundsPerMatch: 1 }, 'two', PLAYERS);
    expect(s.rungs.length).toBe(2);
  });
});
