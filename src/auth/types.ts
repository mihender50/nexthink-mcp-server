/**
 * Auth strategy contract.
 *
 * Each strategy knows how to produce the HTTP headers that authenticate a
 * Nexthink API request. Token-based strategies additionally support
 * invalidation so the HTTP layer can force a refresh after a 401.
 */
export interface AuthProvider {
  /** Human-readable strategy name (for logs/health). */
  readonly kind: string;
  /** Returns headers to attach to an outbound API request. */
  getHeaders(): Promise<Record<string, string>>;
  /** Invalidate any cached credential so the next getHeaders() re-acquires. */
  invalidate(): void;
}
