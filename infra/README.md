# infra

Provisioned in **Phase 2** with AWS SAM (the IaC tool already used in this AWS
account). Nothing here is deployed during Phase 0/1.

Planned resources (all on-demand / free-tier — see root STACK.md):

- DynamoDB tables: `Users`, `Games`, `Matches`, `Connections`, `Notifications`
  (single-table design under evaluation), on-demand billing, TTL on Connections.
- Lambda (Node 20, ARM64): accounts handler, move-pipeline handler,
  WebSocket `$connect` / `$disconnect` / default route handlers.
- API Gateway **WebSocket API** + a small **HTTP API** for REST (login, list
  matches, load).
- No VPC, **no NAT Gateway**, no always-on compute.

Frontend hosting is GitHub Pages (Phase 3), not managed here.
