import axios, { AxiosError, AxiosInstance } from "axios";
import type { AuthProvider } from "../auth/types.js";
import type { NexthinkConfig, RetryConfig } from "../config.js";
import { NexthinkApiError } from "../errors.js";
import type { Logger } from "../logger.js";

/** Parses a Retry-After header (delta-seconds only) into milliseconds. */
export function parseRetryAfterMs(headerValue: unknown): number | null {
  if (typeof headerValue !== "string") return null;
  const secs = Number.parseInt(headerValue.trim(), 10);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  return null;
}

/**
 * Full-jitter exponential backoff (AWS "Exponential Backoff and Jitter"):
 * delay = random(0, min(maxDelay, base * 2^attempt)). Deterministic jitter is
 * injectable for tests.
 */
export function computeBackoffMs(
  attempt: number,
  retry: RetryConfig,
  rand: () => number = Math.random
): number {
  const capped = Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** attempt);
  return Math.floor(rand() * capped);
}

function isRetryableStatus(status?: number): boolean {
  if (status === undefined) return true; // network error / no response
  return status === 429 || (status >= 500 && status < 600);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface RequestOptions {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  context: string; // short label for error/log messages
  /**
   * Whether replaying this request is harmless. Defaults to `true`.
   *
   * Set `false` for calls that cause an irreversible side effect — triggering
   * a Remote Action or a workflow. A 5xx or a dropped connection does **not**
   * tell us the server declined to act, so retrying can run a script on real
   * devices a second time. For those, one attempt and an honest error beats a
   * silent duplicate execution.
   */
  idempotent?: boolean;
}

/**
 * HTTP client for the Nexthink REST API.
 *
 * Cross-cutting concerns handled here so the domain client stays declarative:
 *  - attaches auth headers from the {@link AuthProvider}
 *  - retries 429/5xx/network errors with full-jitter backoff, honoring Retry-After
 *  - on 401, invalidates the token and retries once (handles mid-flight expiry)
 *  - translates every failure into a typed {@link NexthinkApiError}
 */
export class NexthinkHttp {
  private readonly axios: AxiosInstance;

  constructor(
    private readonly config: NexthinkConfig,
    private readonly auth: AuthProvider,
    private readonly logger: Logger,
    private readonly rand: () => number = Math.random
  ) {
    this.axios = axios.create({
      baseURL: config.apiBaseUrl,
      timeout: config.httpTimeoutMs,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      // We handle status-based control flow ourselves.
      validateStatus: () => true,
    });
  }

  async request<T = unknown>(opts: RequestOptions): Promise<T> {
    const maxRetries = this.config.retry.maxRetries;
    let auth401Retried = false;

    for (let attempt = 0; ; attempt++) {
      const headers = await this.auth.getHeaders();
      let status: number | undefined;
      let data: unknown;
      let retryAfterMs: number | null = null;
      let networkError: unknown = null;

      try {
        const res = await this.axios.request({
          method: opts.method,
          url: opts.path,
          data: opts.body,
          headers,
        });
        status = res.status;
        data = res.data;
        retryAfterMs = parseRetryAfterMs(res.headers?.["retry-after"]);

        if (status >= 200 && status < 300) {
          return data as T;
        }

        // 401: token may have expired mid-flight. Refresh once, then retry.
        if (status === 401 && !auth401Retried) {
          auth401Retried = true;
          this.auth.invalidate();
          this.logger.warn("Got 401; invalidated token and retrying once", {
            context: opts.context,
          });
          continue;
        }
      } catch (err) {
        networkError = err;
        this.logger.warn("Network error on request", {
          context: opts.context,
          attempt,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // A non-idempotent call is never replayed: after a 5xx or a dropped
      // connection we cannot know whether the side effect already happened.
      // (The 401 path above is exempt and still retries — an unauthenticated
      // request was rejected before it could act.)
      const replayable = opts.idempotent !== false;
      const retryable = replayable && (networkError !== null || isRetryableStatus(status));
      if (retryable && attempt < maxRetries) {
        const backoff = retryAfterMs ?? computeBackoffMs(attempt, this.config.retry, this.rand);
        this.logger.warn("Retrying request after backoff", {
          context: opts.context,
          attempt,
          status,
          backoff_ms: backoff,
        });
        await sleep(backoff);
        continue;
      }

      // Out of retries (or non-retryable): raise a typed error.
      throw this.toApiError(opts.context, status, data, networkError, retryable);
    }
  }

  private toApiError(
    context: string,
    status: number | undefined,
    data: unknown,
    networkError: unknown,
    retryable: boolean
  ): NexthinkApiError {
    if (networkError) {
      const msg =
        networkError instanceof AxiosError
          ? networkError.message
          : networkError instanceof Error
            ? networkError.message
            : String(networkError);
      return new NexthinkApiError(`${context}: network error: ${msg}`, {
        retryable: true,
      });
    }
    const detailText =
      typeof data === "string" ? data : data ? JSON.stringify(data) : "";
    return new NexthinkApiError(
      `${context} failed (HTTP ${status})${detailText ? `: ${detailText}` : ""}`,
      { status, details: data, retryable }
    );
  }
}
