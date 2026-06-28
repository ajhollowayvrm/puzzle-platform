// Phase 0 placeholder. Phase 1 replaces this with a Vite + PWA local client
// that renders the redacted Chain Reaction view and a pass-and-play / two-client mode.
import { meta } from '@puzzle/game-chain-reaction';

export function boot(): void {
  console.log(`puzzle-platform web shell — game registered: ${meta.name}`);
}
