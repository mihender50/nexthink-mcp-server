/**
 * Typed error hierarchy for the Nexthink MCP server.
 */

/** Thrown when configuration is missing or invalid. Fatal at startup. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Thrown when authentication (token exchange) fails. */
export class AuthError extends Error {
  readonly status?: number;
  readonly details?: unknown;
  constructor(message: string, status?: number, details?: unknown) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.details = details;
  }
}

/**
 * Thrown for any failed Nexthink REST interaction. Carries the HTTP status and
 * raw error body so the MCP layer can surface actionable messages (e.g. an NQL
 * 400 syntax error) back to the model for a self-correction pass.
 */
export class NexthinkApiError extends Error {
  readonly status?: number;
  readonly details?: unknown;
  /** True when the failure is potentially transient (429/5xx/network). */
  readonly retryable: boolean;

  constructor(
    message: string,
    opts: { status?: number; details?: unknown; retryable?: boolean } = {}
  ) {
    super(message);
    this.name = "NexthinkApiError";
    this.status = opts.status;
    this.details = opts.details;
    this.retryable = opts.retryable ?? false;
  }
}
