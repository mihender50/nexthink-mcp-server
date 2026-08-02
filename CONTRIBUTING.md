# Contributing

Thanks for improving the Nexthink MCP Server. This guide covers local setup, the
checks that must pass, and how the codebase is organized.

## Prerequisites

- Node.js **≥ 22**
- (optional) [`pre-commit`](https://pre-commit.com/) and
  [`trufflehog`](https://github.com/trufflesecurity/trufflehog) for local gates

## Setup

```bash
npm install
cp .env.example .env      # fill in a test tenant / bearer token as needed
pre-commit install        # optional: run hygiene gates on every commit
```

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Run the server from TypeScript (no build) over stdio. |
| `npm run build` | Compile to `dist/`. |
| `npm run typecheck` | Type-check without emitting. |
| `npm test` | Unit + integration tests (transform, config, auth, HTTP retry). |
| `npm run test:smoke` | Build, then drive a real stdio MCP handshake. |

Please make sure `npm run typecheck`, `npm test`, and `npm run test:smoke` all
pass before opening a PR. CI (`.github/workflows/ci.yml`) runs the same set plus
the pre-commit hooks.

## Project layout

```
src/
  config.ts            env -> validated config; region-aware URL derivation
  logger.ts            structured JSON logs to stderr, secret redaction
  errors.ts            ConfigError / AuthError / NexthinkApiError
  auth/                pluggable auth strategies + factory
  http/client.ts       retry + backoff + Retry-After + 401-refresh
  transform.ts         NQL v1 (tabular) + v2 (objects) -> normalized records
  nexthink/client.ts   typed facade over the REST endpoints
  server.ts            McpServer tool + resource registration
  index.ts             stdio entry; assembles the stack
test/                  node:test suites + smoke.mjs
docs/RESEARCH.md       sourced MCP/Nexthink findings behind the design
```

## Adding a tool

1. Add the API method to `src/nexthink/client.ts` (goes through `NexthinkHttp`,
   so it inherits retry/auth/timeout).
2. Register it in `src/server.ts` with Zod `inputSchema` **and** `outputSchema`,
   plus `annotations` (`readOnlyHint` for reads, `destructiveHint` for writes).
3. Return via the `ok(...)` helper so clients get `structuredContent` + a JSON
   text fallback; errors go through `fail(...)`.
4. Gate mutating tools behind the `if (!config.readOnly)` block.
5. Add/extend tests and update `test/smoke.mjs`'s expected tool list.

## Conventions

- Strict TypeScript; keep modules pure where practical (`transform.ts`,
  backoff/Retry-After helpers are unit-tested in isolation).
- **Never** write to stdout — it carries the JSON-RPC stream. Use the `Logger`
  (stderr) for diagnostics.
- Never log secrets; the logger redacts known-sensitive keys, but don't rely on
  it — pass identifiers, not credentials.
- Conventional-Commits-style messages (`feat:`, `fix:`, `chore:`, `docs:`…) and
  a `CHANGELOG.md` entry for user-visible changes.

## Vendored `.squad/`

The `.squad/` directory is a vendored framework copied from the fleet and is
excluded from the pre-commit hygiene hooks. Treat it as read-only here.
