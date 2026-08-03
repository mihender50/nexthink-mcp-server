# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 3.x | ✅ |
| 2.x | ❌ — the NQL request contract in 2.x does not match the Nexthink API and cannot execute queries. Upgrade to 3.x. |
| 1.x | ❌ |

## Reporting a vulnerability

Report privately through GitHub's **[Report a vulnerability](https://github.com/mihender50/nexthink-mcp-server/security/advisories/new)** form. Please do **not** open a public issue for a security problem.

Include the affected version, a description, and reproduction steps. Expect an initial response within 7 days. If a fix is warranted, it ships as a patch release with an advisory credited to you unless you prefer otherwise.

## What is in scope

This server is a credentialed bridge between an LLM agent and a Nexthink tenant, so the security-relevant surface is narrow but real:

- **Credential handling** — leakage of `NEXTHINK_CLIENT_SECRET`, `NEXTHINK_BEARER_TOKEN`, `NEXTHINK_PASSWORD`, or a derived OAuth token through logs, error messages, or tool output.
- **Guardrail bypass** — anything that lets a destructive tool run when `NEXTHINK_READ_ONLY=true`, or a Remote Action execute when it is not in `NEXTHINK_ALLOWED_ACTIONS`.
- **Injection into API requests** — model-supplied input reaching a Nexthink request in a way that changes which query or action executes beyond the declared parameters.
- **Response handling** — a malicious or compromised API response corrupting returned data, polluting object prototypes, or crashing the server.

## What is not a vulnerability here

- **NQL queries cannot be composed at call time.** The Nexthink API executes only queries an administrator saved in the web UI, referenced by an immutable Query ID. This server cannot widen that. A saved query that returns more data than intended is a tenant configuration issue, not a server vulnerability.
- **Destructive tools doing destructive things.** `run_remote_action` and `trigger_workflow` change state on real endpoints by design. They are annotated `destructiveHint` so MCP clients gate them behind human approval; a client that ignores that annotation is the issue.
- Vulnerabilities in Nexthink's own API or platform — report those to Nexthink.

## Operator guidance

- Scope Nexthink API credentials to the minimum needed. If the agent only reads telemetry, do not grant remote-action permissions, and set `NEXTHINK_READ_ONLY=true`.
- Use `NEXTHINK_ALLOWED_ACTIONS` as an allow-list whenever destructive tools are enabled. An empty value permits **any** Remote Action id.
- Supply secrets through the environment only. Never commit `.env`. Logs go to stderr with known secret keys redacted, but treat `NEXTHINK_LOG_LEVEL=debug` output as sensitive regardless.
- Pin the version you deploy. This package has not been exercised against a live Nexthink tenant by its maintainer; validate behaviour against your own instance before granting it production credentials.
