/**
 * Environment-driven configuration for the Nexthink MCP server.
 *
 * All configuration is sourced from environment variables so the server can be
 * launched by MCP clients (Claude Desktop, custom agent loops) via a stdio
 * command definition without embedding secrets in code.
 */

export interface NexthinkConfig {
  instanceUrl: string;
  clientId: string;
  clientSecret: string;
  /** Optional allow-list of Remote Action IDs. Empty = allow any (subject to Nexthink RBAC). */
  allowedActions: string[];
  /** When true, mutating tools (remote action / workflow) are not registered. */
  readOnly: boolean;
  /** HTTP request timeout in milliseconds. */
  httpTimeoutMs: number;
}

function normalizeUrl(raw: string): string {
  // Strip trailing slashes so path joins are predictable.
  return raw.replace(/\/+$/, "");
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Loads and validates configuration from the process environment.
 * Throws a descriptive error listing every missing required variable.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): NexthinkConfig {
  const missing: string[] = [];

  const instanceUrl = env.NEXTHINK_INSTANCE_URL?.trim();
  const clientId = env.NEXTHINK_CLIENT_ID?.trim();
  const clientSecret = env.NEXTHINK_CLIENT_SECRET?.trim();

  if (!instanceUrl) missing.push("NEXTHINK_INSTANCE_URL");
  if (!clientId) missing.push("NEXTHINK_CLIENT_ID");
  if (!clientSecret) missing.push("NEXTHINK_CLIENT_SECRET");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        `See .env.example for the full list.`
    );
  }

  const timeoutRaw = env.NEXTHINK_HTTP_TIMEOUT_MS?.trim();
  const httpTimeoutMs = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : 30000;
  if (!Number.isFinite(httpTimeoutMs) || httpTimeoutMs <= 0) {
    throw new Error(
      `NEXTHINK_HTTP_TIMEOUT_MS must be a positive integer, got: ${timeoutRaw}`
    );
  }

  return {
    instanceUrl: normalizeUrl(instanceUrl!),
    clientId: clientId!,
    clientSecret: clientSecret!,
    allowedActions: parseList(env.NEXTHINK_ALLOWED_ACTIONS),
    readOnly: parseBool(env.NEXTHINK_READ_ONLY, false),
    httpTimeoutMs,
  };
}
