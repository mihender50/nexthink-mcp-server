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

## Releasing

Publishing to npm is fully automated — no npm token exists in CI.

1. Bump `version` in `package.json` and add a `CHANGELOG.md` entry; land it on
   `main` via PR (branch protection requires the CI checks).
2. Create a GitHub release with tag `vX.Y.Z` (must match `package.json` —
   the workflow hard-fails on a mismatch) targeting `main`.
3. Publishing the release triggers `.github/workflows/publish.yml`, which
   re-runs the full gate (typecheck, build, tests, stdio smoke test) and then
   runs `npm publish`.

Auth is **npm Trusted Publishing** (OpenID Connect): the npm package is
configured (npmjs.com → package → Settings → Trusted Publisher) to accept
publishes only from GitHub Actions runs of `publish.yml` in
`mihender50/nexthink-mcp-server` using the `prod` environment — which is why
the publish job declares `environment: prod`. The workflow's
`id-token: write` permission lets npm verify the run's OIDC token. There is no
`NPM_TOKEN` secret, nothing to rotate, and a leaked CI log can't leak a
credential.

**Provenance** requires an attestation that is publicly verifiable against a
public source repository. Now that this repository is public, npm produces one
automatically on a Trusted Publishing release. Versions published before that
do not have one — `nexthink-mcp-server@2.0.0` has `attestations: null`, and
`/-/npm/v1/attestations/nexthink-mcp-server@2.0.0` returns 404.

The dist-tag is derived from the Release itself: a GitHub Release marked as a
pre-release publishes to `next`, and only a full release moves `latest`. npm
applies `latest` by default and does not special-case a semver pre-release
suffix, so this has to be explicit.

Note that `2.0.0` was published **manually**, not by this workflow — its
GitHub Release predates `publish.yml` landing on `main`. The workflow's first
execution was the `3.0.0-rc.0` pre-release, which published successfully over
OIDC; the registry records its `_npmUser` as `GitHub Actions`.

If the trusted-publisher config changes on npmjs.com (repo, workflow filename,
or environment name), `publish.yml` must be updated to match.

## Vendored `.squad/`

The `.squad/` directory is a vendored framework copied from the fleet and is
excluded from the pre-commit hygiene hooks. Treat it as read-only here.
