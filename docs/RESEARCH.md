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

- **Base URL:** `https://<instance>.api.<region>.nexthink.cloud`
- **NQL execute v2:** `POST /api/v2/nql/execute` — v2 returns `data` as an array
  of **objects** (`{queryId, executedQuery, rows, executionDateTime, data[]}`);
  v1 returns a tabular `headers`+`rows` matrix. The transformer handles both.
- **NQL export:** `POST /api/v1/nql/export` → `{exportId, status}`; results land
  in S3 and the download URL is fetched via **status** `GET /api/v1/nql/status/<id>`.
- **Remote Actions:** `POST /api/v1/act/execute` with
  `{remoteActionId, devices[], params, expiresInMinutes, triggerInfo}` — devices
  are **Collector ids** (`device.collector.id`).
- **Workflows:** `POST /api/v1/workflows/execute`.

Sources:
- NQL API: https://docs.nexthink.com/api/nql · https://docs.nexthink.com/api/nql/execute-an-nql
- Remote actions API: https://docs.nexthink.com/API/remote-actions/remote-actions-api
- Workflows API: https://developer.nexthink.com/docs/api/workflows-api
- Community OpenAPI/SDK references: https://ltaupiac.github.io/nexthink_api/ · https://github.com/NexthinkGuru/NexthinkAPI
