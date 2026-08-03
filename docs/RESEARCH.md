# Research notes: MCP standard & Nexthink APIs

This document records the sourced findings that shaped the v2 rebuild, so the
design decisions are traceable.

## MCP specification

- **Current stable spec: `2025-11-25`.** A `2026-07-28` revision exists but is a
  **release candidate** (not ratified as of this writing), so we target the
  stable revision and do not adopt RC-only changes (stateless handshake removal,
  `Mcp-Method`/`Mcp-Name` routing headers, tasks-as-extension).
- Relevant stable-spec capabilities we use:
  - **Structured tool output** (`outputSchema` + `structuredContent`), introduced
    2025-06-18 and standard since. We return both structured content and a JSON
    text fallback for text-only clients.
  - **Tool annotations** (`readOnlyHint`, `destructiveHint`, `openWorldHint`) for
    human-in-the-loop gating on mutating tools.
  - **Resources** for the NQL data dictionary.
- SDK: **`@modelcontextprotocol/sdk@^1.30.0`**, using the high-level `McpServer`
  `registerTool`/`registerResource` API with Zod input & output schemas.

Sources:
- MCP spec changelog (2025-11-25): https://modelcontextprotocol.io/specification/2025-11-25/changelog
- 2025-06-18 changelog (structured output, elicitation, RFC 8707): https://modelcontextprotocol.info/specification/2025-06-18/changelog/
- 2026-07-28 release candidate (draft): https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/
- TS SDK server guide: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md

## Nexthink authentication

Nexthink Infinity's public API uses **OAuth 2.0 client-credentials**. The
officially documented flow:

- Token endpoint: `https://<instance>-login.<region>.nexthink.cloud/oauth2/default/v1/token`
- Regions: `us`, `eu`, `pac`, `meta`
- `POST` with `Content-Type: application/x-www-form-urlencoded`
- `Authorization: Basic base64(clientId:clientSecret)`
- Body: `grant_type=client_credentials&scope=service:integration`

The server implements a **pluggable auth layer** covering every
credential-presentation form a Nexthink deployment may need:

| `NEXTHINK_AUTH_TYPE` | Presentation | Use case |
| --- | --- | --- |
| `oauth2_basic` (default) | client id:secret in Basic header | Official documented method |
| `oauth2_post` | client id/secret in form body | Tenants/gateways requiring `client_secret_post` |
| `bearer` | pre-issued bearer token | Vaulted / externally-minted tokens, testing |
| `basic` | username:password Basic | Legacy/on-prem classic Web API |

Sources:
- Getting an authentication token: https://docs.nexthink.com/API/getting-authentication-token
- API credentials: https://docs.nexthink.com/api

## Nexthink API endpoints (real contracts)

Verified against the published API models (`NqlApiExecuteRequest`,
`NqlApiExportRequest`, `NqlApiStatusResponse`, remote-action / workflow
`ExecutionRequest` + `ExecutionResponse`) and cross-checked against two
independent community SDKs. Base URL: `https://<instance>.api.<region>.nexthink.cloud`.

### NQL is execute-by-id, not execute-by-text

**This is the single most important constraint in the whole API surface.** Both
NQL entry points take the **id of a query saved in the Nexthink web interface**
(Administration → Content management → NQL API queries). There is no public
endpoint that accepts ad-hoc NQL text, and none that lists the saved queries.

| | Request | Response |
| --- | --- | --- |
| `POST /api/v2/nql/execute` | `{queryId, parameters?}` | `{queryId, executedQuery, rows, executionDateTime, data[]}` — `data` is an array of **objects** |
| `POST /api/v1/nql/execute` | `{queryId, parameters?}` | same envelope, but `headers: string[]` + `data` as a positional **matrix**. Legacy; kept only for pre-v2 integrations |
| `POST /api/v1/nql/export` | `{queryId, parameters?, compression?}` (`NONE`/`GZIP`/`ZSTD`) | `{exportId}` — **no status field** |
| `GET /api/v1/nql/status/{exportId}` | — | `{status, resultsFileUrl?, errorDescription?}`, status ∈ `SUBMITTED`/`IN_PROGRESS`/`COMPLETED`/`ERROR` |

- `queryId` must match `^#[a-z0-9_]{2,255}$`, e.g. `#devices_with_high_crashes`.
  The id is assigned at creation and is immutable thereafter.
- `parameters` is a flat string→string map. Parameters may only appear in the
  saved query's **`where` clause**, are declared there as `$name`, and are sent
  **without** the `$`. Nothing else about the saved query can be varied at call
  time — including its row limit and time window.

**Design consequence:** agent-driven exploration is bounded by the query catalog
an administrator has authored. The server therefore validates `queryId` locally
and returns an explanatory error rather than letting an ad-hoc NQL string
round-trip into an opaque HTTP 400. See `CHANGELOG.md` at the package root
(3.0.0) for the history —
releases before 3.0.0 posted `{query: "<NQL text>"}` and could not work against
a real tenant.

### Remote actions / workflows

- **Remote Actions:** `POST /api/v1/act/execute` with
  `{remoteActionId, devices[], params, expiresInMinutes?, triggerInfo?}` — devices
  are **Collector ids** (`device.collector.id`), max 10000; `expiresInMinutes`
  is constrained to **60–10080**. Responds `{requestId, expiresInMinutes?}`
  (`requestId`, *not* an execution id — use it to query executions in NQL).
- **Workflows:** `POST /api/v1/workflows/execute` with
  `{workflowId, devices[], users[], params?}` — `devices` are Collector UUIDs,
  `users` are security ids (`^S(-\d+){2,10}$`), both max 10000 and both declared
  required. Responds `{requestUuid, executionsUuids[]}`: one request id, plus one
  execution id per targeted object.

Sources:
- NQL API: https://docs.nexthink.com/api/nql · https://docs.nexthink.com/api/nql/execute-an-nql · https://docs.nexthink.com/API/nql/export-an-nql
- NQL API queries (authoring + parameters): https://docs.nexthink.com/platform/user-guide/administration/content-management/nql-api-queries
- Remote actions API: https://docs.nexthink.com/API/remote-actions/remote-actions-api
- Vendored API models (`nql-models.md`, `remote-actions-models.md`, `workflows-models.md`): https://github.com/ltaupiac/nexthink_api/tree/main/specs/vendor/nexthink-api-docs/current
- Community OpenAPI/SDK references: https://ltaupiac.github.io/nexthink_api/ · https://pkg.go.dev/github.com/deploymenttheory/go-api-sdk-nexthink · https://github.com/NexthinkGuru/NexthinkAPI

### Adjacent findings from independent re-verification

- **Export also has a GET form.** The spec defines `GET /api/v1/nql/export`
  taking `queryId`/`parameters`/`compression` as query-string params
  (operationId `export-get`). Still no raw NQL; we use the POST form.
- **`expiresInMinutes` bounds differ by direction.** The *request* model is
  60–10080; the *response* model is 1–10080. We validate 60–10080 on input only
  and leave the output schema unbounded, so a legitimate response value below
  60 is not rejected.
- **The Go SDK diverges from the official spec** on request shapes — it carries
  `platform`/`format` fields that the OpenAPI spec does not define, and omits
  `parameters` and `compression`. Treat it as corroboration for *response*
  shapes only; the OpenAPI spec is the authority for requests.
- **NXQL (classic) is not a counter-example.** The on-prem V6 Engine Web API V2
  (`/2/query?query=…`, port 1671) does accept raw query text — but that is
  **NXQL**, a different LISP-syntax language against a different product, on a
  different host/port/auth model, and it is deprecated. It is not an ad-hoc
  path for Infinity NQL. Sources:
  https://docs.nexthink.com/platform/latest/introducing-the-nxql-api ·
  https://docs.nexthink.com/platform/latest/getting-data-through-the-nxql-api

### Not pinned by tests

These contracts come from published documentation and SDKs. Anything depending
on undocumented server behaviour (error-body shapes, rate limits,
partial-result semantics) should be treated as unconfirmed.
