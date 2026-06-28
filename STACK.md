# STACK.md — Phase 0 decision & free-tier analysis

_Account inspected 2026-06-28 via `sigil-cli`. All prices us-west-2; verify again
at provisioning time (Phase 2) — treat the free-tier rules as hard limits._

## 1. What's already in the account (602906970045)

| Area | Found | Implication |
|------|-------|-------------|
| IAM | `sigil-cli` has **AdministratorAccess** | Can provision everything from the CLI. |
| IaC | `aws-sam-cli-managed-default…` S3 bucket present | **AWS SAM is the established IaC tool** (sigil, poke-vendor). Reuse it. |
| Compute | 11 Lambdas (sigil-sync, binderbooks-sync, `trivpop_*` incl. `trivpop_auth_user`) | Serverless-only pattern already in place. A **DIY DB-backed auth** Lambda pattern already exists in this account. |
| API GW | HTTP APIs `sigil-api`, `binderbooks-sync`. **No WebSocket API exists.** | We create a new WebSocket API; no collisions. |
| DynamoDB | `binderbooks`, `sigil`, `camel_up_*`, `poke-vendor-saves` | On-demand tables are the norm here. Our tables are namespaced `puzzle-*`. |
| Cognito | one pool (`poke-vendor-users`) | Cognito is available but not required. |
| Hosting | binderbooks/sigil deploy via **GitHub Pages** | Established free static-hosting path → reuse for the PWA. |

No EC2/RDS/Fargate/NAT in the serverless apps. Good baseline.

## 2. Proposed stack

| Layer | Choice | Why |
|-------|--------|-----|
| Language | TypeScript everywhere; game modules in `@puzzle/game-*` shared by Lambda **and** web | Spec §3. Lets the client run identical logic for same-seed local play / optimistic UI. |
| Realtime | **API Gateway WebSocket API** + Lambda routes (`$connect`/`$disconnect`/default) | Spec default. Push channel over authoritative DB state. |
| REST | Small **HTTP API** (apigatewayv2) for login, list/load matches | Matches existing account pattern; cheaper than REST API GW. |
| Compute | **Lambda, Node 20, ARM64 (Graviton)**, no VPC | ARM is ~20% cheaper; no-VPC means **no NAT Gateway**. |
| Data | **DynamoDB on-demand**, TTL on `Connections` | Spec §6. Pay-per-request, no provisioned capacity. |
| Auth | **DIY token auth** (recommended) — see §4 | Consistent with `trivpop_auth_user`; no hosted-UI overhead for a 2-person app. Cognito remains a valid fallback. |
| Hosting | **GitHub Pages**, PWA (manifest + service worker) | Free; your established path. S3+CloudFront unnecessary. |
| IaC | **AWS SAM** (`infra/template.yaml`, Phase 2) | Already the account's tool; SAM bucket exists. |

## 3. Free-tier analysis (at our scale: ~2–6 users, a few matches/day)

Realistic monthly volume assumption: **≤ 50k WebSocket messages, ≤ 100k Lambda
invocations, ≤ 100k DynamoDB read/write ops, a few MB stored.**

| Service | Free allowance | Our usage | Cost at scale |
|---------|----------------|-----------|---------------|
| **API GW WebSocket** | 12-mo free: 1M msgs + 750k conn-min. Then **$1.00/M msgs**, **$0.25/M conn-min** | ~50k msgs, ~5k conn-min/mo | **~$0.05/mo** even after free tier expires |
| **API GW HTTP** | 12-mo free: 1M req. Then $1.00/M | a few thousand req/mo | **~$0** |
| **Lambda** | **Always free**: 1M req + 400k GB-s/mo | ≪ 100k req | **$0** |
| **DynamoDB** | **Always free**: 25 GB storage. On-demand: $1.25/M writes, $0.25/M reads | ≤ 100k ops, few MB | **~$0.10/mo** |
| **GitHub Pages** | Free | static PWA | **$0** |
| **Cognito** (if chosen) | Free for our MAU count | 2–6 users | **$0** |

**Bottom line: $0 during the 12-month free window; ~$0.10–0.20/month afterward.**
The only metered services (WebSocket + DynamoDB on-demand) are pennies at this
volume because they bill per-request with no idle floor.

### Free-tier guardrails (hard rules — spec §3)
- 🚫 **No NAT Gateway.** ~$32/mo just to exist — the classic free-tier killer.
  Mitigation: **Lambdas run with no VPC config.** They reach DynamoDB / API GW
  over the public AWS endpoints (IAM-authorized), so no NAT/VPC endpoints needed.
- 🚫 No provisioned DynamoDB capacity, no global tables — **on-demand only**.
- 🚫 No always-on compute (EC2/ECS/Fargate/RDS) — **serverless only**.
- ✅ WebSocket conn-minutes are the one "time-based" meter; a disconnected client
  costs nothing. We rely on TTL'd `Connections` rows and let idle sockets drop.

**Nothing in this stack risks leaving the free tier at our scale.** If a future
game needs always-on compute or a relational store, that's a stop-and-flag moment.

## 4. The one open decision: DIY token vs Cognito

Spec §3 leaves this to me after inspection. **Recommendation: DIY token auth**,
because (a) a working DIY auth Lambda (`trivpop_auth_user`) already exists in this
account to mirror, (b) Cognito's hosted UI / SRP flow is overkill for a 2-person
app, and (c) both are $0 here, so the tiebreaker is simplicity.

DIY done safely (spec §3 guardrails):
- Hash with a **vetted KDF** — use Node's built-in **`crypto.scrypt`** (zero deps,
  no native-binary pain in Lambda; argon2/bcrypt are fine but add a build step).
- Store **only** the hash + per-user salt. Never the password.
- Issue **random opaque tokens** (`crypto.randomBytes`) with an **expiry**, stored
  server-side (a `Tokens` table or a `tokenHash`+`ttl` on the user). No hand-rolled
  crypto, no JWT-signing footguns.
- WebSocket `$connect` authorizes via the token (query-string or subprotocol),
  binds `connectionId → userId`.

If you'd rather not own auth at all, say so and I'll use Cognito instead — same $0,
slightly less code to maintain, slightly more service surface to learn.

## 5. What Phase 0 delivered (this commit)

- TS monorepo (npm workspaces + project references): `packages/core`,
  `packages/games/chain-reaction`, `apps/web`, `infra`, `packs/`, `scripts/`.
- `@puzzle/core`: the §4 game-module interface, a seeded RNG, a game registry.
- `@puzzle/game-chain-reaction`: §7 state/move/view types + `meta` (impl in Phase 1).
- `npm run build` (tsc project-reference build) is green.

No AWS resources provisioned. Provisioning happens in Phase 2 after Phase 1's
playable local prototype.
