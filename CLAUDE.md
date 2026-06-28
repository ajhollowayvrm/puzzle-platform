# CLAUDE.md — Multiplayer Puzzle Platform

Build instructions and persistent project context. Read this fully before writing code. Build in the phases at the bottom; don't jump ahead.

---

## 1. What we're building

A small platform for two people (and later a few friends) to play **multiplayer puzzle games** against or alongside each other. The first game is **Chain Reaction** (a word-chain game). The platform must make adding the *next* game a matter of writing one module file, not touching the backend.

Two human users to start: a couple. Must scale to a handful of accounts and several games without re-architecture. **Everything must stay inside the AWS free tier** at this scale.

### Non-negotiable design goals
1. **Game-agnostic core.** Rooms, players, persistence, realtime delivery, accounts, and match lifecycle know nothing about any specific game.
2. **Games are plugins.** A game is one module implementing a fixed interface (Section 4). New game = new module + one registry row. Zero core changes.
3. **Server is authoritative; state is redacted per player.** In competitive play the client must never receive information it shouldn't see (e.g. unrevealed answers). This is a correctness *and* anti-cheat requirement, not a nicety.
4. **Live and async are the same backend.** State always lives in the DB. The WebSocket is an optional push channel layered on top. Presence decides *delivery*, never architecture.

---

## 2. The two interaction models (most important architectural fact)

Different puzzle games have fundamentally different shapes. The module declares which one it is via `meta.model`:

- **`shared-turn`** — one shared board, players alternate turns acting on the same state. Example: **Chain Reaction**. Naturally live; works async too.
- **`same-seed-compare`** — both players get an *identical* puzzle from one random seed, play **independent** boards, and the app compares results. Example: a match-3 score race, or a "who scores more on the same letters" word race. Naturally async and challenge-shaped; works live with presence too.

Do **not** force `same-seed-compare` games into a turn loop. The interface supports both first-class. (Royal Match is `same-seed-compare`; see Section 8 note before implementing anything match-3.)

---

## 3. Stack decisions (you decide specifics; constraints are fixed)

Before building, **inspect the user's AWS account via the AWS CLI**, report what's there, and propose a concrete stack. Then confirm free-tier fit before writing infra.

Fixed constraints / strong defaults:
- **Language:** TypeScript everywhere. Game modules live in a shared package importable by **both** Lambda and the web client (lets the client run the same logic for same-seed local play and optimistic UI). This shared-module property is a core reason to use TS — preserve it.
- **Backend (default):** API Gateway **WebSocket API** + **Lambda** + **DynamoDB**. All on-demand / pay-per-use.
- **Auth:** DB-backed accounts are fine and free. You choose DIY-token vs **Cognito** after inspecting the account — both are free at this scale. DIY is the easiest place to introduce a subtle security bug, so if you go DIY, use a vetted hashing library (argon2/bcrypt/scrypt), store only hashes, and use random opaque tokens with expiry. Don't hand-roll crypto.
- **Frontend hosting:** static site, installable as a **PWA**. GitHub Pages or S3+CloudFront — pick based on what's already set up.

### Free-tier guardrails (verify current pricing at build time; treat as hard rules)
- **No NAT Gateway.** It is the classic free-tier killer (~$32/mo just to exist). Keep Lambdas out of private subnets that need NAT, or skip VPC entirely for these functions.
- DynamoDB **on-demand**; no provisioned capacity, no global tables.
- No always-on compute (no idle EC2/ECS/Fargate, no RDS). Serverless only.
- WebSocket API: confirm the current always-free vs 12-month-free status and message/connection-minute costs before committing; at two-player volume it should be cents at most. Report the number.
- Static hosting must be free (Pages) or effectively free (S3+CloudFront within free tier).

If any choice risks leaving the free tier at our scale, stop and flag it before building.

---

## 4. The game module interface (the heart of the platform)

Every game implements this. Keep it small and stable; resist adding game-specific concepts to the core.

```ts
type GameModel = 'shared-turn' | 'same-seed-compare';
type GameMode  = 'versus' | 'coop';
type Metric    = 'score' | 'moves' | 'timeMs';

interface GameMeta {
  id: string;                 // 'chain-reaction'
  name: string;               // 'Chain Reaction'
  model: GameModel;
  modes: GameMode[];          // which it supports
  minPlayers: number;
  maxPlayers: number;
  scoring: {
    metrics: Metric[];                          // which metrics this game produces
    direction: Partial<Record<Metric, 'higher' | 'lower'>>;
    // primary metric first decides the winner; rest break ties in order.
    priority: Metric[];
  };
}

interface PlayerRef { playerId: string; handle: string; }

interface MoveContext {
  playerId: string;
  now: number;                // server timestamp (ms)
  rng: () => number;          // seeded RNG; deterministic per match+seed
}

interface ApplyResult<S> {
  state: S;
  events?: GameEvent[];       // optional, for UI animations / notifications
  error?: string;             // if set, move was illegal; state MUST be unchanged
}

interface MatchResult {
  perPlayer: Record<string, Partial<Record<Metric, number>>>;
  winnerIds: string[];        // [] while ongoing; >1 means tie
  complete: boolean;
}

interface GameModule<S = unknown, M = unknown, View = unknown, Cfg = unknown> {
  meta: GameMeta;

  // Build initial state. For same-seed-compare, `seed` MUST fully determine the puzzle
  // so both players get an identical board.
  createState(config: Cfg, seed: string, players: PlayerRef[]): S;

  // Validate + apply. MUST be pure and deterministic given (state, move, ctx).
  // On illegal move: return { state: <unchanged>, error }.
  applyMove(state: S, move: M, ctx: MoveContext): ApplyResult<S>;

  // shared-turn only: whose turn. same-seed-compare returns null.
  currentTurn?(state: S): string | null;

  isOver(state: S): boolean;

  result(state: S): MatchResult;

  // CRITICAL: return the view a given player is allowed to see.
  // Must strip every piece of hidden info (answers, opponents' private boards, etc.).
  redact(state: S, forPlayerId: string): View;
}
```

### Hard rules for module authors
- `applyMove` is **pure and deterministic**. No `Date.now()`, no `Math.random()` — use `ctx.now` and `ctx.rng`. This makes server validation and replay reliable.
- `redact` is the security boundary. The server only ever sends `redact(state, player)` to a client — never raw `state`. If a field would let a player cheat, it must not survive redaction.
- For `same-seed-compare`, recommended state shape: `{ shared, perPlayer: { [id]: ... } }`. `redact` strips other players' `perPlayer` entries. This also means players write disjoint sub-state, avoiding write conflicts.

---

## 5. Generic core responsibilities

The core (Lambda handlers + a thin service layer) does exactly this and nothing game-specific:

1. **Accounts** — register, log in, issue/verify tokens.
2. **Match lifecycle** — create match (gameId, mode, players, seed), join via code or invite, list "my matches", load, complete.
3. **Move pipeline** (the only write path):
   ```
   receive move
   → load Match by id
   → load module by Match.gameId
   → auth: is this player in the match? (shared-turn: is it their turn?)
   → applyMove(state, move, ctx)
   → if error: return 4xx, do not write
   → conditional write of new state guarded by Match.version (optimistic lock)
   → deliver redact(newState, p) to each player:
        connected  → push over WebSocket
        offline    → enqueue notification
   → return redact(newState, caller) to the caller
   ```
4. **Realtime delivery** — track WebSocket connections; route pushes to the right match's players.
5. **Presence → delivery only.** Connected gets a live push; disconnected gets a notification and reads the same DB state on next open. Same writes either way.

The core must be able to run **two games at once with no code change** — that's the acceptance bar.

---

## 6. Data model (DynamoDB; single- or multi-table is your call)

Entities (sketch — refine for your access patterns):

- **Users**: `userId` (PK), `handle` (unique, GSI), `passwordHash`, `createdAt`.
- **Games**: `gameId` (PK) — registry row per installed module: cached `meta`, current `packVersion`. "More games" = more rows.
- **Matches**: `matchId` (PK), `gameId`, `mode`, `model`, `playerIds[]`, `seed`, `state` (JSON), `version` (int, optimistic lock), `status` (`waiting`|`active`|`complete`), `turn` (nullable), `updatedAt`, `createdAt`.
  - GSI: list a user's matches (by playerId), filter by status.
- **Connections**: `connectionId` (PK), `userId`, `matchId`, `ttl` — for WebSocket routing. TTL auto-expires stale rows.
- **Notifications** (or an outbox): pending pushes for offline players in async play.

"More accounts and games" is free by design: accounts are Users rows, games are Games rows, a match is `gameId + playerIds + state`.

---

## 7. Game module #1 — Chain Reaction (full spec)

`model: 'shared-turn'`, `modes: ['versus']` first (`coop` later), `minPlayers: 2`, `maxPlayers: 2`.
`scoring`: metric `score`, direction `higher`, priority `['score']`.

### Puzzle shape
A chain has a fixed **START** word and **END** word (both shown) and **N hidden middle rungs** (start with N=2–3). Each rung connects to its neighbour above and below via a real compound word or common two-word phrase (e.g. `SNOW → BALL → ROOM → MATE`: snowball, ballroom, roommate).

### State (server-side, pre-redaction)
```ts
interface ChainState {
  start: string;
  end: string;
  rungs: Array<{
    answer: string;        // hidden
    revealed: number;      // letters shown from the left, 0..answer.length
    value: number;         // current pot, starts 10
    solvedBy: string | null;
  }>;
  scores: Record<string, number>;
  turn: string;            // playerId
  order: string[];         // turn order
}
```

### Turn options (a player picks exactly ONE per turn)
- **Peek** a rung: `revealed += 1` (cap at length); `value = max(2, value - 2)`. Turn passes.
- **Solve** a rung (submit a guess):
  - **Correct:** banker's `scores[player] += value`; `solvedBy = player`. Turn passes.
  - **Wrong:** leak penalty — `revealed += 1` and `value = max(2, value - 2)` (same as a peek the opponent didn't have to spend their turn on), then turn passes.

Strict alternation: every action passes the turn. Round ends when all rungs are `solvedBy != null`. Winner = higher `scores` total. Match = best across a configurable number of rounds (tally).

### Redaction (`redact`)
For each rung, send only: `revealed` count, the **first `revealed` letters** of `answer`, `answer.length`, `value`, `solvedBy`. **Never send the full `answer` or any unrevealed letters.** Send `scores`, `turn`, `start`, `end`. Add a redaction unit test asserting no rung's full answer appears in any player's view while unsolved.

### Tuning knobs (expose as match config; the user wants to tune by feel)
`startingValue` (10), `peekPenalty` (2), `valueFloor` (2), `middleRungs` (2–3), `roundsPerMatch`. Keep these in `config` so they can be changed without code edits.

---

## 8. Puzzle content as data

Answers are **content, not code**, shipped as versioned JSON packs: `packs/chain-reaction/v1.json`.

- **No API keys in the frontend.** Generate packs **offline** with a separate Node script that may use an Anthropic API key from the local environment, then commit the validated JSON. The shipped app only reads JSON.
- **Validate every chain** at generation time: each adjacent pair must form a real compound word / common phrase; reject anything unverified. A bad pack is worse than a small one.
- Version packs so the app can pin a version and you can refresh the bank anytime by regenerating.
- (Optional, later) If you ever want live generation, put the key in a tiny Lambda/Cloudflare Worker — never the static client.

**Royal Match note:** Royal Match is a copyrighted, trademarked commercial game. Do **not** clone its assets, levels, branding, or name. If the user wants that itch scratched, build an **original** match-3 module (generic gem/tile theme, own art, own name) that fits the `same-seed-compare` model. Treat "Royal Match" as a genre reference, not a spec.

---

## 9. Frontend

- TypeScript PWA (installable on phones), static-hosted. Web app manifest + service worker for installability and basic offline shell.
- Connects WebSocket when foregrounded; on background/offline, relies on REST + notifications and re-syncs from DB state on open.
- Renders only the **redacted view** from the server. In `versus`, never treat local state as truth.
- Chain Reaction UI: scoreboard (both players, current turn highlighted), the chain as a vertical spine of letter-slot rungs with each rung's pot value, and a one-action-per-turn control (Peek selected rung / Solve with a text guess). The chosen design risk is the spine "charging" in the solver's colour as rungs are won — keep everything else quiet. Respect `prefers-reduced-motion`; ensure visible keyboard focus.

---

## 10. Testing & quality gates

- **Redaction tests (mandatory, per module):** a redacted view must contain no hidden field. For Chain Reaction: unsolved answers and unrevealed letters never appear in any player's view.
- **Interface conformance:** a shared test suite every module must pass — `applyMove` purity/determinism (same inputs → same output, no clock/RNG leakage), illegal moves leave state unchanged + return error, `isOver`/`result` consistency.
- **Optimistic-lock test:** two concurrent writes to the same match — one wins, one retries cleanly; no clobbering.
- **Genericity proof:** the core runs Chain Reaction and the second (match-3) module with zero core edits. This is the platform's whole thesis — gate on it.

---

## 11. Open product decision (carry until the user answers)

For `same-seed-compare` games, the user hasn't fixed whether ranking is by **high score** vs **fewest moves / fastest time**. The interface already supports all three via `meta.scoring.metrics` + `priority`. Build the comparator generically; let each module declare its priority. Don't hardcode "score wins."

---

## 12. Build phases (do in order; each ends playable/verifiable)

**Phase 0 — Recon & scaffold.** Inspect AWS via CLI, report findings, propose stack + confirm free-tier (call out NAT Gateway explicitly). Scaffold the TS monorepo: `packages/core`, `packages/games/chain-reaction`, `apps/web`, `infra`.

**Phase 1 — Prototype on a mock core (no AWS yet).** Implement the generic core against an **in-memory** store, the Chain Reaction module, and a minimal local web UI. Fully playable locally, pass-and-play + a fake "two clients" mode. Redaction + conformance tests green. *Goal: tune Chain Reaction's scoring/peek feel by playing it.* Nothing here is throwaway — Phase 2 swaps the mock store for real infra behind the same interfaces.

**Phase 2 — Real backend.** DynamoDB tables, Lambda handlers for the move pipeline + accounts, API Gateway WebSocket API, auth (Cognito or DIY per Phase 0 decision). Deploy. Same module, same interface, real persistence + live push.

**Phase 3 — Frontend deploy + async.** Host the PWA, wire WebSocket-when-present / notification-when-absent, "my matches" list, resume-from-DB. Both phones can install it and play live or async.

**Phase 4 — Prove genericity.** Add the original match-3 module (`same-seed-compare`) to validate the interface holds two very different games. Build the offline puzzle-pack generator + validator for Chain Reaction. Add `coop` mode to Chain Reaction if wanted.

---

## 13. Working style for this project

- Inspect before assuming (AWS state, existing setup) — the user has the CLI wired up for you.
- Confirm free-tier impact before provisioning anything; report real numbers.
- Prefer concise, numbered clarifying questions with no preset answers when you genuinely need a decision.
- Keep the core game-agnostic. Every time you're tempted to put game logic in the core, that logic belongs in a module instead.
