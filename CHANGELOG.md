# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
