# Nexthink MCP Server

[![CI](https://github.com/mihender50/nexthink-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/mihender50/nexthink-mcp-server/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/nexthink-mcp-server)](https://www.npmjs.com/package/nexthink-mcp-server)

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that
exposes Nexthink Digital Employee Experience (DEX) telemetry and automation to
LLM agents. Built against the MCP `2025-11-25` stable spec (structured tool
output, tool annotations, resources) on `@modelcontextprotocol/sdk` v1.30.

```
+-------------------+   MCP (JSON-RPC / stdio)   +-------------------------+   OAuth2 / Bearer / Basic   +-----------------------------+
|  LLM / Agent      | <------------------------> |   Nexthink MCP Server   | <-------------------------> |  Nexthink Infinity          |
| (Claude / custom) |   structured tool output   |  auth -> retry -> domain|   HTTPS, region-partitioned |  (NQL, Act, Workflows APIs)  |
+-------------------+                            +-------------------------+                             +-----------------------------+
```

## What it does

- **Authentication** — all four Nexthink credential forms, selected by one env
  var: OAuth2 client credentials (Basic-header and form-body), pre-issued
  bearer, and legacy HTTP Basic. See [Authentication](#authentication).
- **Token handling** — in-memory OAuth token cache with proactive refresh and a
  single-flight guard, so concurrent tool calls don't stampede the token
  endpoint.
- **Retries** — `429`/`5xx`/network errors retry with full-jitter exponential
  backoff, honoring `Retry-After`, alongside per-request timeouts and a one-shot
  401 → token-refresh → retry. `4xx` (e.g. an unknown query id) is not retried;
  the error body is surfaced back to the model for self-correction.
- **Structured output** — every tool declares a Zod `outputSchema` and returns
  validated `structuredContent`, with a JSON text fallback.
- **Guardrails** — `destructiveHint` annotations for human-in-the-loop gating,
  an optional read-only mode, and a Remote Action allow-list.
- **Logging** — single-line JSON to stderr (never stdout), with secret
  redaction.
- **Region handling** — derives the `*.api.<region>.nexthink.cloud` base and
  `<instance>-login.<region>...` token endpoint from instance + region.

## Documentation

Everything referenced here either ships inside this package or is a public URL.

Shipped in the package, alongside `dist/`:

| File | Contents |
| --- | --- |
| `docs/CAPABILITIES.md` | Full capability matrix: every tool's inputs, structured output, MCP annotations, and the exact Nexthink endpoint it calls; auth matrix; guardrails; what's deliberately not implemented. |
| `docs/RESEARCH.md` | The sourced API findings behind the implementation — real request/response contracts with citations, and an explicit statement of what remains unverified. |
| `CHANGELOG.md` | Version history, including the 3.0.0 breaking changes. |

After installing, read them from the package directory:

```bash
npm view nexthink-mcp-server           # registry metadata
npm pack nexthink-mcp-server           # fetch the tarball, then extract
tar -xzf nexthink-mcp-server-*.tgz && ls package/docs
```

Or, if it's already installed as a dependency:

```bash
cat node_modules/nexthink-mcp-server/docs/CAPABILITIES.md
```

External references:

- Model Context Protocol — <https://modelcontextprotocol.io>
- MCP `2025-11-25` specification — <https://modelcontextprotocol.io/specification/2025-11-25/changelog>
- Nexthink NQL API — <https://docs.nexthink.com/api/nql>
- Authoring NQL API queries (where Query IDs come from) — <https://docs.nexthink.com/platform/user-guide/administration/content-management/nql-api-queries>
- Nexthink API credentials & auth token — <https://docs.nexthink.com/API/getting-authentication-token>

## Important: NQL queries run by ID, not by text

Nexthink's public API **cannot execute ad-hoc NQL**. Both `/api/v2/nql/execute`
and `/api/v1/nql/export` accept only `{queryId, parameters}`, where `queryId`
identifies a query an administrator saved in the Nexthink web interface under
**Administration → Content management → NQL API queries**. Saving assigns an
immutable Query ID matching `^#[a-z0-9_]{2,255}$`; the API then replays that
query, substituting only the `where`-clause parameters it declares.

Practically, this server lets an agent **run a curated catalog of queries**
rather than compose new ones:

1. An administrator authors the query in the web UI and notes its Query ID.
2. The agent calls `execute_nql(query_id="#…", parameters={…})`.

There is no API to list saved queries, so supply the ids your agent may use in
its prompt or configuration. New questions need a new saved query. Row limits,
time windows and projections are baked into the saved query and cannot be
overridden at call time.

> **Upgrading from 2.x — breaking.** Versions before 3.0.0 exposed a `query`
> input and POSTed `{query: "<NQL text>"}`. The API never accepted that, so NQL
> calls could not succeed against a real tenant. In 3.0.0:
> `execute_nql`/`export_nql_async` take `query_id` + `parameters` instead of
> `query`; `execute_nql`'s `limit` became `max_rows` (client-side trim only);
> `run_remote_action` returns `request_id` instead of `execution_id`/`status`;
> and `trigger_workflow` returns `request_uuid` + `execution_uuids[]`.

## Tools

| Tool | Kind | Description |
| --- | --- | --- |
| `execute_nql` | read-only | Run a **saved** NQL query by id (with optional parameters); normalized rows (handles v1 tabular **and** v2 object responses). |
| `export_nql_async` | read-only | Schedule a bulk async export of a **saved** NQL query → export id. |
| `get_nql_export_status` | read-only | Poll an export by id; returns the download URL when `COMPLETED`. |
| `run_remote_action` | **destructive** | Trigger a Remote Action on devices (by Collector id). |
| `trigger_workflow` | **destructive** | Trigger an IT workflow / engagement campaign on devices and/or users. |

Destructive tools are hidden entirely when `NEXTHINK_READ_ONLY=true`.

### Example

Given a saved query `#high_crash_devices` whose where-clause declares
`$binary_name`:

```jsonc
// execute_nql
{ "query_id": "#high_crash_devices", "parameters": { "binary_name": "chrome.exe" } }
```

`max_rows` is also accepted, but it only trims rows client-side to protect the
model's context — it does not change the query the API runs.

## Resources

| URI | Description |
| --- | --- |
| `nexthink://schema/nql-reference` | How saved queries and parameters work, plus NQL syntax, time clauses, aggregations, domains, and the `device.collector.id` tip for remote actions. |

## Authentication

Nexthink Infinity's public API uses OAuth 2.0 client-credentials. This server
supports every credential-presentation form via `NEXTHINK_AUTH_TYPE`:

| `NEXTHINK_AUTH_TYPE` | Required vars | Notes |
| --- | --- | --- |
| `oauth2_basic` *(default)* | `NEXTHINK_CLIENT_ID`, `NEXTHINK_CLIENT_SECRET` | Official method: id:secret in the HTTP Basic header, `scope=service:integration`. |
| `oauth2_post` | `NEXTHINK_CLIENT_ID`, `NEXTHINK_CLIENT_SECRET` | Credentials in the form body (`client_secret_post`). |
| `bearer` | `NEXTHINK_BEARER_TOKEN` | Pre-issued/vaulted token; no refresh. |
| `basic` | `NEXTHINK_USERNAME`, `NEXTHINK_PASSWORD` | Legacy/on-prem classic Web API. |

The OAuth token endpoint is derived from instance + region, or set explicitly
with `NEXTHINK_TOKEN_URL`.

## Configuration

Every variable the server reads:

| Variable | Required | Description |
| --- | --- | --- |
| `NEXTHINK_INSTANCE` + `NEXTHINK_REGION` | yes¹ | Instance name + region (`us`/`eu`/`pac`/`meta`); derives all URLs. |
| `NEXTHINK_API_BASE_URL` | yes¹ | Explicit API base (overrides derivation; for proxies/on-prem). `NEXTHINK_INSTANCE_URL` is accepted as an alias. |
| `NEXTHINK_AUTH_TYPE` + its vars | yes | See [Authentication](#authentication). Default `oauth2_basic`. |
| `NEXTHINK_READ_ONLY` | — | `true` hides the destructive tools. |
| `NEXTHINK_ALLOWED_ACTIONS` | — | Comma-separated Remote Action allow-list. |
| `NEXTHINK_HTTP_TIMEOUT_MS` / `NEXTHINK_MAX_RETRIES` / `NEXTHINK_RETRY_BASE_MS` / `NEXTHINK_RETRY_MAX_MS` | — | Reliability tuning. |
| `NEXTHINK_LOG_LEVEL` | — | `debug`/`info`/`warn`/`error`. Structured JSON to stderr. |
| `NEXTHINK_SCOPE` | — | OAuth scope. Default `service:integration`. |
| `NEXTHINK_TOKEN_URL` | — | Explicit OAuth token endpoint (overrides derivation). |
| `NEXTHINK_NQL_EXECUTE_PATH` | — | Pin the execute endpoint. Default `/api/v2/nql/execute`; set to `/api/v1/nql/execute` only for pre-v2 compatibility. |

¹ Provide **either** `NEXTHINK_INSTANCE`+`NEXTHINK_REGION` **or** `NEXTHINK_API_BASE_URL`.

Defaults: `NEXTHINK_HTTP_TIMEOUT_MS=30000`, `NEXTHINK_MAX_RETRIES=3`,
`NEXTHINK_RETRY_BASE_MS=500`, `NEXTHINK_RETRY_MAX_MS=8000`,
`NEXTHINK_READ_ONLY=false`, `NEXTHINK_LOG_LEVEL=info`. An empty
`NEXTHINK_ALLOWED_ACTIONS` means any Remote Action id is permitted.

## Quick start

Published on [npm](https://www.npmjs.com/package/nexthink-mcp-server) — no
clone or build needed. Register it with an MCP client (Claude Desktop shown;
any stdio MCP client works the same way):

```json
{
  "mcpServers": {
    "nexthink": {
      "command": "npx",
      "args": ["-y", "nexthink-mcp-server"],
      "env": {
        "NEXTHINK_INSTANCE": "your-instance",
        "NEXTHINK_REGION": "eu",
        "NEXTHINK_AUTH_TYPE": "oauth2_basic",
        "NEXTHINK_CLIENT_ID": "your-client-id",
        "NEXTHINK_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

Requires Node.js ≥ 22 on the machine running the client. Running from a
checkout instead? Use `"command": "node"` with
`"args": ["/abs/path/to/nexthink-mcp-server/dist/index.js"]`.

## Development

```bash
npm install
npm run build
npm start          # reads config from the environment
npm run dev        # ts, no build step
```

## Test

```bash
npm run typecheck
npm test           # unit + integration (transform, config, auth, HTTP retry)
npm run test:smoke # builds, then drives the server over a real stdio MCP handshake
```

## Architecture

Module layout — the compiled equivalent ships as `dist/`, mirroring this tree:

```
src/
  config.ts            # env -> validated config; region-aware URL derivation
  logger.ts            # structured JSON logs to stderr, secret redaction
  errors.ts            # ConfigError / AuthError / NexthinkApiError (retryable flag)
  auth/                # pluggable auth strategies (oauth basic|post, bearer, basic)
  http/client.ts       # retry + full-jitter backoff + Retry-After + 401-refresh
  transform.ts         # NQL v1 (tabular) + v2 (objects) -> normalized records
  nexthink/client.ts   # typed facade over NQL / Act / Workflows endpoints
  server.ts            # McpServer: registerTool (Zod in/out) + registerResource
  index.ts             # stdio entry; assembles the stack
```

The request path per tool call: **auth provider → HTTP client (retry) → domain
client → normalized result → structured tool output**.

## API references

API contracts here are implemented from Nexthink's published API models
(`NqlApiExecuteRequest`, `NqlApiExportRequest`, `NqlApiStatusResponse`, and the
remote-action / workflow `ExecutionRequest`+`ExecutionResponse`) and
cross-checked against two independent community SDKs. Primary sources:

- NQL API — <https://docs.nexthink.com/api/nql>
- Execute an NQL — <https://docs.nexthink.com/api/nql/execute-an-nql>
- Export an NQL — <https://docs.nexthink.com/API/nql/export-an-nql>
- Authoring NQL API queries — <https://docs.nexthink.com/platform/user-guide/administration/content-management/nql-api-queries>
- Remote actions API — <https://docs.nexthink.com/API/remote-actions/remote-actions-api>

Roll out against a non-production instance first, and start with
`NEXTHINK_READ_ONLY=true` so the destructive tools stay hidden until the read
path is confirmed against your tenant.

Scope note: this server targets **Nexthink Infinity cloud** (`NQL`). The older
on-prem V6 Engine exposes a separate, deprecated **NXQL** API that does accept
raw query text over a different host, port, and auth model. That API is out of
scope here and is not a workaround for the saved-query requirement above.

## Security notes

- Least privilege: scope Nexthink API credentials to read-only NQL unless remote
  actions are needed; combine with `NEXTHINK_READ_ONLY` and/or
  `NEXTHINK_ALLOWED_ACTIONS`.
- Human-in-the-loop: destructive tools are annotated so clients gate them behind
  approval.
- Secrets come from the environment only and are redacted from logs; never commit
  `.env`.

## License

MIT. The full text ships in the package as `LICENSE`.
