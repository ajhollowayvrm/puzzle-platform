// Phase 0 scaffold: meta + types only. The GameModule implementation
// (createState/applyMove/redact/...) lands in Phase 1.
import type { GameMeta } from '@puzzle/core';

export * from './types.js';

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
