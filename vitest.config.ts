import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Alias workspace packages to their TS source so tests run without a prebuild.
// Subpaths are listed before the bare package so they match first.
export default defineConfig({
  resolve: {
    alias: [
      { find: '@puzzle/core/testkit', replacement: r('./packages/core/src/testkit.ts') },
      { find: '@puzzle/core/auth', replacement: r('./packages/core/src/auth.ts') },
      { find: '@puzzle/core', replacement: r('./packages/core/src/index.ts') },
      {
        find: '@puzzle/game-chain-reaction',
        replacement: r('./packages/games/chain-reaction/src/index.ts'),
      },
    ],
  },
  test: {
    include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'],
  },
});
