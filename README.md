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
npm run qa          # gate: tsc project-reference build + vitest (run before committing)
npm run web:dev     # play Chain Reaction locally (Vite dev server)
```

## Build phases

Tracked in `CLAUDE.md §12`.

- **Phase 0 — recon & scaffold** ✅ (`STACK.md`)
- **Phase 1 — playable local prototype on an in-memory mock core** ✅
  - generic core (`@puzzle/core`): `Store` + `InMemoryStore`, `MatchService` move
    pipeline (turn auth, optimistic-lock write+retry, redacted per-player delivery),
    DIY scrypt auth (`@puzzle/core/auth`), conformance testkit (`@puzzle/core/testkit`)
  - Chain Reaction module: full §7 rules, multi-round, starter puzzle pack
  - `apps/web`: playable local UI (two-client + pass-and-play), renders redacted views only
  - tests: redaction security gate, interface conformance, optimistic-lock retry — all green
- **Phase 2 — real backend** ✅: DynamoDB + Lambda (Function URL) via SAM, running the
  same `MatchService`/`AccountService` behind a new `DynamoStore`. Real accounts (DIY
  scrypt), create-a-match → share an invite code → opponent joins from another device,
  server-side redaction, client polls for the opponent's moves. `infra/template.yaml`.
  - Backend: `packages/server` (DynamoStore + Lambda router); deploy with
    `sam deploy --template-file infra/template.yaml --stack-name puzzle-platform --resolve-s3 --capabilities CAPABILITY_IAM`.
  - Web: sign in (or "play on this device"); cloud play talks to the Function URL.
- **Phase 3 — async + WebSocket push + PWA install** (next): replace polling with an
  API Gateway WebSocket push channel; add the installable PWA manifest/service worker.
