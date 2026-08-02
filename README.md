# Nexthink MCP Server

An **enterprise-grade** [Model Context Protocol](https://modelcontextprotocol.io)
(MCP) server that exposes **Nexthink** Digital Employee Experience (DEX)
telemetry and automation to LLM agents. Built against the **MCP `2025-11-25`**
stable spec (structured tool output, tool annotations, resources) on
`@modelcontextprotocol/sdk` v1.30.

```
+-------------------+   MCP (JSON-RPC / stdio)   +-------------------------+   OAuth2 / Bearer / Basic   +-----------------------------+
|  LLM / Agent      | <------------------------> |   Nexthink MCP Server   | <-------------------------> |  Nexthink Infinity          |
| (Claude / custom) |   structured tool output   |  auth -> retry -> domain|   HTTPS, region-partitioned |  (NQL, Act, Workflows APIs)  |
+-------------------+                            +-------------------------+                             +-----------------------------+
```

## Why this is production-ready

- **All Nexthink auth types**, pluggable via one env var — OAuth2 client
  credentials (Basic-header *and* form-body), pre-issued bearer, and legacy HTTP
  Basic. See [Authentication](#authentication).
- **Fast**: in-memory OAuth token cache with proactive refresh and a
  **single-flight** guard so concurrent tool calls never stampede the token
  endpoint.
- **Reliable**: automatic retries on `429`/`5xx`/network errors with
  **full-jitter exponential backoff**, `Retry-After` honoring, per-request
  timeouts, and a one-shot **401 → token-refresh → retry**. `4xx` (e.g. bad NQL)
  is *not* retried — the error body is surfaced back to the model for
  self-correction.
- **Structured output**: every tool declares a Zod `outputSchema` and returns
  validated `structuredContent` (plus a JSON text fallback).
- **Safe by default**: `destructiveHint` annotations for human-in-the-loop
  gating, an optional read-only mode, and a Remote Action allow-list.
- **Observable**: structured single-line JSON logs to **stderr** (never stdout),
  with automatic secret redaction.
- **Region-aware**: derives the correct `*.api.<region>.nexthink.cloud` base and
  `<instance>-login.<region>...` token endpoint from instance + region.

See [`docs/RESEARCH.md`](./docs/RESEARCH.md) for the sourced spec/API findings.

## Tools

| Tool | Kind | Description |
| --- | --- | --- |
| `execute_nql` | read-only | Synchronous NQL query; normalized rows (handles v1 tabular **and** v2 object responses). |
| `export_nql_async` | read-only | Schedule a bulk async NQL export → export id. |
| `get_nql_export_status` | read-only | Poll an export by id; returns download URL when ready. |
| `run_remote_action` | **destructive** | Trigger a Remote Action on devices (by Collector id). |
| `trigger_workflow` | **destructive** | Trigger an IT workflow / engagement campaign. |

Destructive tools are hidden entirely when `NEXTHINK_READ_ONLY=true`.

## Resources

| URI | Description |
| --- | --- |
| `nexthink://schema/nql-reference` | NQL syntax, time clauses, aggregations, domains, and the `device.collector.id` tip for remote actions. |

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

See [`.env.example`](./.env.example) for the full annotated list. Essentials:

| Variable | Required | Description |
| --- | --- | --- |
| `NEXTHINK_INSTANCE` + `NEXTHINK_REGION` | yes¹ | Instance name + region (`us`/`eu`/`pac`/`meta`); derives all URLs. |
| `NEXTHINK_API_BASE_URL` | yes¹ | Explicit API base (overrides derivation; for proxies/on-prem). |
| `NEXTHINK_AUTH_TYPE` + its vars | yes | See [Authentication](#authentication). Default `oauth2_basic`. |
| `NEXTHINK_READ_ONLY` | — | `true` hides the destructive tools. |
| `NEXTHINK_ALLOWED_ACTIONS` | — | Comma-separated Remote Action allow-list. |
| `NEXTHINK_HTTP_TIMEOUT_MS` / `NEXTHINK_MAX_RETRIES` / `NEXTHINK_RETRY_BASE_MS` / `NEXTHINK_RETRY_MAX_MS` | — | Reliability tuning. |
| `NEXTHINK_LOG_LEVEL` | — | `debug`/`info`/`warn`/`error`. |

¹ Provide **either** `NEXTHINK_INSTANCE`+`NEXTHINK_REGION` **or** `NEXTHINK_API_BASE_URL`.

## Install, build, run

```bash
npm install
npm run build
npm start          # reads config from the environment
npm run dev        # ts, no build step
```

### Register with an MCP client (Claude Desktop)

```json
{
  "mcpServers": {
    "nexthink": {
      "command": "node",
      "args": ["/abs/path/to/nexthink-mcp-server/dist/index.js"],
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

## Test

```bash
npm run typecheck
npm test           # unit + integration (transform, config, auth, HTTP retry)
npm run test:smoke # builds, then drives the server over a real stdio MCP handshake
```

## Architecture

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

## Security notes

- Least privilege: scope Nexthink API credentials to read-only NQL unless remote
  actions are needed; combine with `NEXTHINK_READ_ONLY` and/or
  `NEXTHINK_ALLOWED_ACTIONS`.
- Human-in-the-loop: destructive tools are annotated so clients gate them behind
  approval.
- Secrets come from the environment only and are redacted from logs; never commit
  `.env`.

## License

MIT — see [LICENSE](./LICENSE).
