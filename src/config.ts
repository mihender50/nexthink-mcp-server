import { ConfigError } from "./errors.js";
import type { LogLevel } from "./logger.js";

/**
 * Environment-driven configuration.
 *
 * Nexthink Infinity URLs are region-partitioned. Given an instance name and a
 * region, the API base and OAuth token endpoint are derived automatically:
 *
 *   API base:  https://<instance>.api.<region>.nexthink.cloud
 *   Token URL: https://<instance>-login.<region>.nexthink.cloud/oauth2/default/v1/token
 *
 * Either can be overridden explicitly for on-prem / proxied / test setups.
 */

export type NexthinkRegion = "us" | "eu" | "pac" | "meta";
const REGIONS: NexthinkRegion[] = ["us", "eu", "pac", "meta"];

/**
 * Supported credential-presentation strategies. Nexthink Infinity's public API
 * uses OAuth 2.0 client-credentials; the variants below cover every form a
 * Nexthink deployment (or a fronting gateway / vaulted token) may require.
 */
export type AuthType =
  | "oauth2_basic" // client_credentials, credentials in HTTP Basic header (official)
  | "oauth2_post" // client_credentials, credentials in form body (client_secret_post)
  | "bearer" // pre-issued/externally-managed bearer token (e.g. vaulted)
  | "basic"; // HTTP Basic username:password (legacy/on-prem classic Web API)

export interface OAuthConfig {
  type: "oauth2_basic" | "oauth2_post";
  clientId: string;
  clientSecret: string;
  scope: string;
  tokenUrl: string;
}
export interface BearerConfig {
  type: "bearer";
  token: string;
}
export interface BasicConfig {
  type: "basic";
  username: string;
  password: string;
}
export type AuthConfig = OAuthConfig | BearerConfig | BasicConfig;

export interface EndpointPaths {
  nqlExecute: string;
  nqlExport: string;
  nqlStatus: string;
  actExecute: string;
  workflowExecute: string;
  campaignTrigger: string;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface NexthinkConfig {
  apiBaseUrl: string;
  auth: AuthConfig;
  endpoints: EndpointPaths;
  allowedActions: string[];
  readOnly: boolean;
  httpTimeoutMs: number;
  retry: RetryConfig;
  logLevel: LogLevel;
}

const DEFAULT_ENDPOINTS: EndpointPaths = {
  nqlExecute: "/api/v2/nql/execute",
  nqlExport: "/api/v1/nql/export",
  nqlStatus: "/api/v1/nql/status",
  actExecute: "/api/v1/act/execute",
  workflowExecute: "/api/v1/workflows/execute",
  campaignTrigger: "/api/v1/campaigns/trigger",
};

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
}

function parseList(v: string | undefined): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseIntEnv(v: string | undefined, fallback: number, name: string): number {
  if (v === undefined || v.trim() === "") return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new ConfigError(`${name} must be a non-negative integer, got: ${v}`);
  }
  return n;
}

function deriveApiBaseUrl(env: NodeJS.ProcessEnv): string {
  const explicit = env.NEXTHINK_API_BASE_URL || env.NEXTHINK_INSTANCE_URL;
  if (explicit?.trim()) return stripTrailingSlash(explicit.trim());

  const instance = env.NEXTHINK_INSTANCE?.trim();
  const region = env.NEXTHINK_REGION?.trim().toLowerCase();
  if (!instance || !region) {
    throw new ConfigError(
      "Set NEXTHINK_API_BASE_URL, or both NEXTHINK_INSTANCE and NEXTHINK_REGION " +
        `(region one of: ${REGIONS.join(", ")}).`
    );
  }
  if (!REGIONS.includes(region as NexthinkRegion)) {
    throw new ConfigError(
      `NEXTHINK_REGION must be one of: ${REGIONS.join(", ")}, got: ${region}`
    );
  }
  return `https://${instance}.api.${region}.nexthink.cloud`;
}

function deriveTokenUrl(env: NodeJS.ProcessEnv): string {
  const explicit = env.NEXTHINK_TOKEN_URL;
  if (explicit?.trim()) return explicit.trim();

  const instance = env.NEXTHINK_INSTANCE?.trim();
  const region = env.NEXTHINK_REGION?.trim().toLowerCase();
  if (!instance || !region) {
    throw new ConfigError(
      "OAuth auth requires NEXTHINK_TOKEN_URL, or both NEXTHINK_INSTANCE and " +
        "NEXTHINK_REGION so the token endpoint can be derived."
    );
  }
  return `https://${instance}-login.${region}.nexthink.cloud/oauth2/default/v1/token`;
}

function resolveAuth(env: NodeJS.ProcessEnv): AuthConfig {
  // Default to the officially documented method (Basic header client credentials).
  const authType = (env.NEXTHINK_AUTH_TYPE?.trim().toLowerCase() ||
    "oauth2_basic") as AuthType;

  switch (authType) {
    case "oauth2_basic":
    case "oauth2_post": {
      const clientId = env.NEXTHINK_CLIENT_ID?.trim();
      const clientSecret = env.NEXTHINK_CLIENT_SECRET?.trim();
      if (!clientId || !clientSecret) {
        throw new ConfigError(
          `NEXTHINK_AUTH_TYPE=${authType} requires NEXTHINK_CLIENT_ID and NEXTHINK_CLIENT_SECRET.`
        );
      }
      return {
        type: authType,
        clientId,
        clientSecret,
        scope: env.NEXTHINK_SCOPE?.trim() || "service:integration",
        tokenUrl: deriveTokenUrl(env),
      };
    }
    case "bearer": {
      const token = env.NEXTHINK_BEARER_TOKEN?.trim();
      if (!token) {
        throw new ConfigError(
          "NEXTHINK_AUTH_TYPE=bearer requires NEXTHINK_BEARER_TOKEN."
        );
      }
      return { type: "bearer", token };
    }
    case "basic": {
      const username = env.NEXTHINK_USERNAME?.trim();
      const password = env.NEXTHINK_PASSWORD?.trim();
      if (!username || !password) {
        throw new ConfigError(
          "NEXTHINK_AUTH_TYPE=basic requires NEXTHINK_USERNAME and NEXTHINK_PASSWORD."
        );
      }
      return { type: "basic", username, password };
    }
    default:
      throw new ConfigError(
        `Unknown NEXTHINK_AUTH_TYPE "${authType}". Supported: ` +
          "oauth2_basic, oauth2_post, bearer, basic."
      );
  }
}

function resolveLogLevel(v: string | undefined): LogLevel {
  const level = (v?.trim().toLowerCase() || "info") as LogLevel;
  if (!["debug", "info", "warn", "error"].includes(level)) {
    throw new ConfigError(
      `NEXTHINK_LOG_LEVEL must be one of debug, info, warn, error, got: ${v}`
    );
  }
  return level;
}

/** Loads and validates configuration from the environment. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): NexthinkConfig {
  const apiBaseUrl = deriveApiBaseUrl(env);
  const auth = resolveAuth(env);

  const httpTimeoutMs = parseIntEnv(
    env.NEXTHINK_HTTP_TIMEOUT_MS,
    30000,
    "NEXTHINK_HTTP_TIMEOUT_MS"
  );
  if (httpTimeoutMs === 0) {
    throw new ConfigError("NEXTHINK_HTTP_TIMEOUT_MS must be greater than 0.");
  }

  return {
    apiBaseUrl,
    auth,
    endpoints: {
      ...DEFAULT_ENDPOINTS,
      nqlExecute:
        env.NEXTHINK_NQL_EXECUTE_PATH?.trim() || DEFAULT_ENDPOINTS.nqlExecute,
    },
    allowedActions: parseList(env.NEXTHINK_ALLOWED_ACTIONS),
    readOnly: parseBool(env.NEXTHINK_READ_ONLY, false),
    httpTimeoutMs,
    retry: {
      maxRetries: parseIntEnv(env.NEXTHINK_MAX_RETRIES, 3, "NEXTHINK_MAX_RETRIES"),
      baseDelayMs: parseIntEnv(
        env.NEXTHINK_RETRY_BASE_MS,
        500,
        "NEXTHINK_RETRY_BASE_MS"
      ),
      maxDelayMs: parseIntEnv(
        env.NEXTHINK_RETRY_MAX_MS,
        8000,
        "NEXTHINK_RETRY_MAX_MS"
      ),
    },
    logLevel: resolveLogLevel(env.NEXTHINK_LOG_LEVEL),
  };
}

export { REGIONS, DEFAULT_ENDPOINTS };
