import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Resolve workspace packages to TS source so the dev server needs no prebuild.
// base: './' keeps asset paths relative for GitHub Pages hosting (Phase 3).
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@puzzle/core': r('../../packages/core/src/index.ts'),
      '@puzzle/game-chain-reaction': r('../../packages/games/chain-reaction/src/index.ts'),
    },
  },
});
