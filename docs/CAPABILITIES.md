# Capability Matrix — nexthink-mcp-server

Snapshot of what this server (v2.0.0) exposes and implements, grounded in the
source. See [`RESEARCH.md`](./RESEARCH.md) for the spec/API findings behind it.

## Tools

| Tool | R/W | MCP annotations | Key inputs | Structured output | Nexthink call |
| --- | --- | --- | --- | --- | --- |
| `execute_nql` | read | `readOnlyHint`, `openWorldHint` | `query`, `limit?` (1–1000) | `total_rows`, `results[]`, `query_id?`, `executed_query?`, `execution_datetime?` | `POST /api/v2/nql/execute` |
| `export_nql_async` | read | `readOnlyHint`, `openWorldHint` | `query` | `export_id`, `status`, `raw?` | `POST /api/v1/nql/export` |
| `get_nql_export_status` | read | `readOnlyHint`, `openWorldHint` | `export_id` | `result` (status + download URL) | `GET /api/v1/nql/status/{id}` |
| `run_remote_action` | **write** | `destructiveHint`, `openWorldHint` | `remote_action_id`, `devices[]` (Collector ids), `params?`, `expires_in_minutes?`, `trigger_info?` | `execution_id`, `status`, `target_count`, `raw?` | `POST /api/v1/act/execute` |
| `trigger_workflow` | **write** | `destructiveHint`, `openWorldHint` | `workflow_id`, `params?`, `devices?` | `execution_id`, `status`, `raw?` | `POST /api/v1/workflows/execute` |

Write tools are hidden entirely when `NEXTHINK_READ_ONLY=true`.

## Resources

| URI | Type | Content |
| --- | --- | --- |
| `nexthink://schema/nql-reference` | static, `text/markdown` | NQL syntax, domains, time clauses, `device.collector.id` tip |

## Authentication (`NEXTHINK_AUTH_TYPE`)

| Type | Selector value | Credentials | Presentation | Token refresh | Default |
| --- | --- | --- | --- | --- | --- |
| OAuth2 client-credentials (Basic) | `oauth2_basic` | client id + secret | `Authorization: Basic` to token endpoint, `scope=service:integration` | cache + proactive (60 s margin) + single-flight | ✅ |
| OAuth2 client-credentials (POST) | `oauth2_post` | client id + secret | `client_id`/`client_secret` in form body | same | — |
| Static bearer | `bearer` | pre-issued token | `Authorization: Bearer` | none (static) | — |
| HTTP Basic | `basic` | username + password | `Authorization: Basic` | none (static) | — |

## Reliability / enterprise features

| Capability | Status | Detail |
| --- | --- | --- |
| Retry on `429`/`5xx`/network | ✅ | Full-jitter exponential backoff (`baseDelayMs`→`maxDelayMs`), `maxRetries` configurable |
| `Retry-After` honoring | ✅ | Overrides computed backoff when present |
| `401` → token-refresh → retry | ✅ | One-shot, invalidates cached token |
| `4xx` (bad NQL) not retried | ✅ | Error body surfaced to the model for self-correction |
| Per-request timeout | ✅ | `NEXTHINK_HTTP_TIMEOUT_MS` (default 30 s) |
| Structured logging | ✅ | Single-line JSON to **stderr**, secret redaction |
| Region-aware URL derivation | ✅ | `us`/`eu`/`pac`/`meta` → `*.api.<region>...` + `<instance>-login...` |
| NQL v1 (tabular) + v2 (objects) normalization | ✅ | Transparent in the transformer |

## Guardrails & config

| Control | Env | Effect |
| --- | --- | --- |
| Read-only mode | `NEXTHINK_READ_ONLY` | Hides both write tools |
| Remote Action allow-list | `NEXTHINK_ALLOWED_ACTIONS` | Rejects any `remote_action_id` not listed (403) |
| Endpoint/base overrides | `NEXTHINK_API_BASE_URL`, `NEXTHINK_TOKEN_URL`, `NEXTHINK_NQL_EXECUTE_PATH` | On-prem / proxy / version pin |
| Log level | `NEXTHINK_LOG_LEVEL` | `debug` / `info` / `warn` / `error` |

## MCP surface declared

Implemented: `tools` · `resources` · `instructions` · structured tool output
(`outputSchema` + `structuredContent`) · tool annotations · **stdio** transport.

Not implemented (by design, candidates for growth): prompts, sampling,
elicitation, MCP-layer logging notifications, completions, resource
templates/subscriptions, Streamable HTTP transport. The two highest-value
additions would be **Streamable HTTP** (remote hosting, multiple clients) and
**elicitation** (server-driven confirm-before-remote-action).
