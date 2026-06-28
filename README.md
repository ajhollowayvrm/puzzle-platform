# puzzle-platform

A small, game-agnostic platform for playing multiplayer puzzle games. The core
(rooms, accounts, persistence, realtime, match lifecycle) knows nothing about any
specific game; **games are plugins** implementing one fixed interface. First game:
**Chain Reaction**. Everything runs inside the AWS free tier.

See [`CLAUDE.md`](./CLAUDE.md) for the full spec and [`STACK.md`](./STACK.md) for
the Phase 0 stack decision and free-tier analysis.

## Layout

```
packages/core                  generic platform: game-module interface, registry, RNG
packages/games/chain-reaction  game module #1 (shared-turn word-chain)
apps/web                       TypeScript PWA client (static-hosted)
infra                          AWS SAM stack (Phase 2)
packs/                         versioned puzzle content (JSON), generated offline
scripts/                       offline tooling (puzzle-pack generator, etc.)
```

## Develop

```bash
npm install
npm run build       # tsc project-reference build of all packages
npm test            # vitest (redaction + conformance tests, Phase 1+)
```

## Build phases

Tracked in `CLAUDE.md §12`. Currently: **Phase 0 — recon & scaffold (done)**.
Next: Phase 1 — playable local prototype on an in-memory mock core.
