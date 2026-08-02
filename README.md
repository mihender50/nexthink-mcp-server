# Nexthink MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that
exposes **Nexthink** Digital Employee Experience (DEX) telemetry and automation
to LLM agents and assistant interfaces.

Through this server, an agent can:

1. **Query DEX data** — run [Nexthink Query Language (NQL)](https://docs.nexthink.com/)
   queries for device health, binary executions, crashes, network connections,
   and user context.
2. **Execute remediation** — trigger pre-approved Remote Actions (PowerShell/Bash)
   on targeted devices.
3. **Trigger engagement workflows** — launch IT workflows and user campaigns.
4. **Inspect schema context** — load the NQL data dictionary and syntax rules as
   an MCP resource to reduce query hallucinations.

```
+-------------------+     MCP (JSON-RPC / stdio)    +-------------------------+     OAuth 2.0 / HTTPS    +---------------------+
|  LLM / Agent      | <---------------------------> |   Nexthink MCP Server   | <----------------------> |  Nexthink Cloud     |
| (Claude / custom) |                               |     (TypeScript)        |                          |  (NQL & Act APIs)   |
+-------------------+                               +-------------------------+                          +---------------------+
```

## Tools

| Tool | Kind | Description |
| --- | --- | --- |
| `execute_nql` | read-only | Run a synchronous NQL query (≤1000 rows), returned as key-value records. |
| `export_nql_async` | read-only | Schedule a bulk async NQL export; returns a pollable job id. |
| `run_remote_action` | **destructive** | Trigger a Remote Action on target devices. |
| `trigger_workflow` | **destructive** | Trigger an IT workflow / user campaign. |

Destructive tools carry MCP `destructiveHint` annotations so clients (Claude
Desktop, custom agent loops) can require human approval before invoking them.

## Resources

| URI | Description |
| --- | --- |
| `nexthink://schema/nql-reference` | NQL syntax rules, time clauses, aggregations, and core domains. |

## Configuration

All configuration comes from environment variables. Copy `.env.example` and fill
in your tenant details:

| Variable | Required | Description |
| --- | --- | --- |
| `NEXTHINK_INSTANCE_URL` | ✅ | Tenant base URL, e.g. `https://your-company.nexthink.cloud`. |
| `NEXTHINK_CLIENT_ID` | ✅ | OAuth client id (Administration → Account Management → API Credentials). |
| `NEXTHINK_CLIENT_SECRET` | ✅ | OAuth client secret. |
| `NEXTHINK_ALLOWED_ACTIONS` | — | Comma-separated allow-list of Remote Action ids. When set, any other id is rejected. |
| `NEXTHINK_READ_ONLY` | — | `true` disables the destructive tools entirely. |
| `NEXTHINK_HTTP_TIMEOUT_MS` | — | Request timeout in ms (default `30000`). |

Authentication uses the OAuth 2.0 **Client Credentials** grant. The server
caches the access token in memory and refreshes it automatically 60 seconds
before expiry, using a single-flight mutex to avoid token stampedes.

## Install & build

```bash
npm install
npm run build
```

## Run

```bash
# after build
NEXTHINK_INSTANCE_URL=https://your-company.nexthink.cloud \
NEXTHINK_CLIENT_ID=... \
NEXTHINK_CLIENT_SECRET=... \
npm start

# or, during development (no build step)
npm run dev
```

The server speaks MCP over **stdio**. Diagnostics are written to stderr so they
never corrupt the JSON-RPC stream on stdout.

### Registering with an MCP client (e.g. Claude Desktop)

```json
{
  "mcpServers": {
    "nexthink": {
      "command": "node",
      "args": ["/absolute/path/to/nexthink-mcp-server/dist/index.js"],
      "env": {
        "NEXTHINK_INSTANCE_URL": "https://your-company.nexthink.cloud",
        "NEXTHINK_CLIENT_ID": "your-client-id",
        "NEXTHINK_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

## Test

```bash
npm test        # runs the node:test suite via tsx
npm run typecheck
```

## Response normalization

Nexthink's `/api/v2/nql/execute` returns a compact tabular payload
(`headers` + `rows` matrix). The server flattens it into an array of records so
the model never has to do positional index lookups:

```jsonc
// raw Nexthink
{ "executionTime": 42,
  "data": { "headers": [{ "name": "device.name" }, { "name": "device.hardware.memory" }],
            "rows": [["HOST-NY-01", 16384]] } }

// normalized (sent to the model)
{ "total_rows": 1, "execution_time_ms": 42,
  "results": [{ "device.name": "HOST-NY-01", "device.hardware.memory": 16384 }] }
```

## Security notes

- **Least privilege:** create dedicated Nexthink API credentials scoped to
  read-only NQL unless Remote Actions are genuinely required. Combine with
  `NEXTHINK_READ_ONLY=true` and/or `NEXTHINK_ALLOWED_ACTIONS` to constrain the
  agent.
- **Human-in-the-loop:** destructive tools are annotated so clients can gate
  them behind explicit approval.
- **Error transparency:** HTTP 400 (bad NQL) bodies are surfaced back to the
  model so it can self-correct; back off on HTTP 429.
- Secrets are read from the environment only — never commit `.env`.

## License

MIT — see [LICENSE](./LICENSE).
