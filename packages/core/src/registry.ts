import type { GameModule } from './types.js';

// The registry is the ONLY place the core learns which games exist.
// "More games" = register one more module here (Phase 1) or a Games DB row
// pointing at a module pack (Phase 2+). The move pipeline looks games up by id.
const modules = new Map<string, GameModule<any, any, any, any>>();

export function register(module: GameModule<any, any, any, any>): void {
  if (modules.has(module.meta.id)) {
    throw new Error(`game already registered: ${module.meta.id}`);
  }
  modules.set(module.meta.id, module);
}

export function getModule(gameId: string): GameModule<any, any, any, any> {
  const m = modules.get(gameId);
  if (!m) throw new Error(`unknown game: ${gameId}`);
  return m;
}

export function listModules(): GameModule<any, any, any, any>[] {
  return [...modules.values()];
}
