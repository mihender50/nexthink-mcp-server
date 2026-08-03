# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] — 2026-08-03

Corrects the NQL request contract. Every prior release POSTed
`{query: "<NQL text>"}` to `/api/v2/nql/execute` and `/api/v1/nql/export`, which
the Nexthink API has never accepted — so **`execute_nql` and `export_nql_async`
could not succeed against a real tenant**. The API executes queries *by id*,
referencing a query saved in the Nexthink web interface. Auditing the rest of
the surface found the same class of defect in three response parsers, which read
fields the API does not return.

### Breaking
- `execute_nql` now takes `query_id` (+ optional `parameters`) instead of
  `query`. Ids match `^#[a-z0-9_]{2,255}$` and refer to a query saved under
  Administration → Content management → NQL API queries; a missing leading `#`
  is added automatically.
- `execute_nql`'s `limit` is replaced by `max_rows`, which trims rows
  **client-side** only. The old parameter appended `| limit N` to the query
  text, which cannot work when the query is selected by id — server-side limits
  belong in the saved query. Responses set `truncated: true` when rows are
  dropped.
- `export_nql_async` now takes `query_id` (+ optional `parameters`,
  `compression`: `NONE`/`GZIP`/`ZSTD`) instead of `query`, and returns
  `{export_id, raw}`. The previous `status` field was fabricated — the export
  response contains only `exportId`.
- `get_nql_export_status` returns `{status, results_file_url?,
  error_description?, raw}` instead of an opaque `result` blob.
- `run_remote_action` returns `request_id` (the API's `requestId`) plus optional
  `expires_in_minutes`, replacing `execution_id`/`status`. The old code read
  `executionId`/`execution_id`/`id` — none of which the API returns — so
  `execution_id` was always `""`, and `status` was a hardcoded `"QUEUED"`.
- `trigger_workflow` returns `{request_uuid, execution_uuids[], target_count}`,
  matching the API's `{requestUuid, executionsUuids[]}`; the old
  `execution_id`/`status` were likewise fabricated. It also accepts `users`
  (security ids), always sends both target arrays as the API requires, and
  rejects a call with no targets.

### Fixed
- NQL v1 response normalization targeted a shape the API never returns (nested
  `data.headers[{name}]` + `data.rows`). The real v1 envelope is flat:
  top-level `headers: string[]` plus `data` as a positional matrix. v1 responses
  previously normalized to zero rows.
- `expires_in_minutes` is validated against the API's real 60–10080 range
  instead of any positive integer; `devices`/`users` arrays are capped at 10000.
- Parameter keys are sent without the `$` that names them inside the query, so
  passing the in-query spelling no longer 400s.

### Fixed — untrusted-payload hardening (found in review)
- Wrong-typed envelope metadata no longer breaks the whole tool call. `queryId`,
  `executedQuery` and `executionDateTime` were copied through unchecked, so a
  `null` (or any non-string) failed the tool's output-schema validation *after*
  the handler returned — bypassing the handler's error path and discarding rows
  that had been fetched successfully. Non-strings are now dropped. A `rows`
  value that isn't a safe non-negative integer (JSON permits `1e999` →
  `Infinity`) falls back to the row count instead of failing `z.number().int()`.
- v1/v2 discrimination no longer keys off `headers` alone. A payload with
  `headers` *and* object rows — what a gateway echoing column metadata onto a v2
  response produces — was zipped positionally, nulling every cell while
  reporting the correct row count and column names. Silent data corruption;
  v1 now additionally requires positional row arrays.
- A `__proto__` column no longer pollutes the prototype. Rows were built with
  `record[name] = value`, which invokes the `Object.prototype` setter, so
  server-supplied data was installed as a record's prototype and the column
  silently vanished. Rows are now built with `Object.fromEntries`, which defines
  properties instead of setting them.
- Duplicate and blank column names no longer drop data: repeats are suffixed
  (`a`, `a_2`) and blanks become positional (`column_0`), instead of several
  columns collapsing onto one key.
- Parameter keys that collide after `$`-stripping (`{$region, region}`) are now
  rejected. Previously last-wins resolved by property order, so identical inputs
  in a different order ran different queries. An empty key after stripping is
  also rejected.
- Response coercion no longer emits `"[object Object]"` for a malformed payload
  (e.g. as `results_file_url`); non-primitives degrade to `""`, and junk entries
  are dropped from `execution_uuids`.
- `run_remote_action` no longer fails **after** the action has executed. The
  API's `expiresInMinutes` was passed through on a bare `typeof === "number"`
  check, so a fractional, non-finite, or out-of-range value failed the tool's
  `z.number().int()` output schema — which the SDK validates *after* the
  handler returns, bypassing its error handling. The Remote Action had already
  run on real devices, `request_id` was destroyed, and the model received an
  opaque schema error inviting a retry of a destructive operation. Unusable
  values are now dropped; `raw` still carries what the API sent.
- `export_nql_async` now reports a response with no `exportId` as an error
  rather than returning an empty handle the caller cannot poll. The destructive
  tools deliberately keep degrading instead of throwing, so a caller always
  learns that an action fired.

- Non-idempotent requests are no longer replayed. `POST /api/v1/act/execute`
  and `POST /api/v1/workflows/execute` were retried on `5xx` and on network
  errors like any other request, but neither tells us the server declined to
  act — so a transient failure could run a script on real devices, or re-prompt
  real users, a second time. Both are now marked non-idempotent and attempt
  once; everything else retries as before. The one-shot `401 → refresh → retry`
  still applies, since an unauthenticated request was rejected before it could
  act.

### Added — tool-layer test coverage
- `test/server.test.ts` drives the real `McpServer` over an in-memory transport
  and asserts all five tools' output stays schema-valid across 17 hostile
  response bodies. This layer previously had no coverage at all, which is how
  the `expires_in_minutes` defect above survived two review passes: it is
  invisible below the tool boundary.

### Added
- Local `queryId` validation that rejects NQL text with an error explaining the
  saved-query model, rather than emitting an opaque HTTP 400.
- `test/client.test.ts`: contract tests pinning the exact request bodies and
  response mappings against the published API models — the regression guard
  this defect class needed. Smoke test now asserts the advertised tool schemas.

### Changed
- `nexthink://schema/nql-reference` leads with the execute-by-id model and how
  parameters bind, so agents stop drafting query text they cannot submit.
- README, `docs/CAPABILITIES.md` and `docs/RESEARCH.md` document the real
  contracts, with sources and the exact Nexthink endpoint each tool calls.

## [2.0.0] — 2026-08-02

Enterprise rebuild targeting the stable **MCP `2025-11-25`** specification.

### Added
- **All Nexthink-supported auth types**, pluggable via `NEXTHINK_AUTH_TYPE`:
  `oauth2_basic` (official), `oauth2_post`, `bearer`, and `basic`.
- Resilient HTTP layer: retries on `429`/`5xx`/network with full-jitter
  exponential backoff, `Retry-After` honoring, per-request timeouts, and a
  one-shot `401 → token-refresh → retry`.
- OAuth token cache with proactive refresh and a single-flight guard.
- Structured tool output (`outputSchema` + `structuredContent`) via the modern
  `McpServer` `registerTool` API with Zod schemas.
- New tool `get_nql_export_status` for polling async exports.
- Region-aware URL derivation for `us`/`eu`/`pac`/`meta`.
- Structured JSON logging to stderr with secret redaction.
- Test suites for the transformer, config derivation, auth strategies, and HTTP
  retry/backoff, plus an stdio MCP handshake smoke test wired into CI.
- `docs/RESEARCH.md` recording the sourced MCP/Nexthink findings.

### Changed
- Corrected endpoints to the real Nexthink API: base
  `https://<instance>.api.<region>.nexthink.cloud`, token endpoint
  `https://<instance>-login.<region>.nexthink.cloud/oauth2/default/v1/token`,
  Remote Actions `POST /api/v1/act/execute` (`remoteActionId` + `devices` by
  Collector id + `triggerInfo`), NQL execute `POST /api/v2/nql/execute`.
- NQL response transformer now handles **both** v2 (object rows) and v1
  (tabular) responses.
- Upgraded `@modelcontextprotocol/sdk` to `^1.30.0`.
- All dependencies on latest: TypeScript 7, Zod 4, tsx 4.23, `@types/node` 26,
  axios 1.19. Node baseline raised to **≥ 22** (Node 20 is EOL); CI runs
  Node 24 LTS.
- `.squad/` instance state reset for this repository (agent histories,
  decisions, learnings, loop state); framework and templates unchanged.

### Breaking
- Config variables changed: prefer `NEXTHINK_INSTANCE` + `NEXTHINK_REGION`
  (or `NEXTHINK_API_BASE_URL`) and `NEXTHINK_AUTH_TYPE`. See `.env.example`.
- `run_remote_action` inputs changed to `remote_action_id` / `devices`
  (Collector ids) / `params` / `trigger_info`, matching the real API.

## [1.0.0] — 2026-08-02

### Added
- Initial Nexthink MCP server: `execute_nql`, `export_nql_async`,
  `run_remote_action`, `trigger_workflow` tools; `nexthink://schema/nql-reference`
  resource; OAuth 2.0 client-credentials auth; tabular NQL response
  normalization; read-only mode and Remote Action allow-list.
