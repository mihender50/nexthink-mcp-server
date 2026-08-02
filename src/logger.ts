/**
 * Minimal structured logger.
 *
 * CRITICAL: everything is written to **stderr**. On a stdio MCP transport,
 * stdout carries the JSON-RPC frame stream — any stray write there corrupts the
 * protocol. Logs are emitted as single-line JSON for easy ingestion by log
 * pipelines (Splunk, Datadog, ELK) in enterprise deployments.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Keys whose values must never be logged, even if passed in a fields object. */
const REDACT_KEYS = new Set([
  "authorization",
  "password",
  "client_secret",
  "clientsecret",
  "secret",
  "token",
  "access_token",
  "bearer",
]);

function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = REDACT_KEYS.has(k.toLowerCase()) ? "[redacted]" : v;
  }
  return out;
}

export class Logger {
  constructor(private readonly minLevel: LogLevel = "info") {}

  private log(level: LogLevel, msg: string, fields?: Record<string, unknown>) {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    const line = {
      level,
      msg,
      component: "nexthink-mcp",
      ...(fields ? redact(fields) : {}),
    };
    // No timestamp: Date.now()/new Date() are intentionally avoided so the
    // module stays pure/deterministic; the log transport adds ingest time.
    process.stderr.write(JSON.stringify(line) + "\n");
  }

  debug(msg: string, fields?: Record<string, unknown>) {
    this.log("debug", msg, fields);
  }
  info(msg: string, fields?: Record<string, unknown>) {
    this.log("info", msg, fields);
  }
  warn(msg: string, fields?: Record<string, unknown>) {
    this.log("warn", msg, fields);
  }
  error(msg: string, fields?: Record<string, unknown>) {
    this.log("error", msg, fields);
  }
}
