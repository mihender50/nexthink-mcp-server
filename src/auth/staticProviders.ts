import type { AuthProvider } from "./types.js";
import type { BasicConfig, BearerConfig } from "../config.js";

/**
 * Pre-issued bearer token (e.g. sourced from a secrets vault or a short-lived
 * token minted out of band). No refresh — invalidation is a no-op because the
 * strategy has no way to re-mint.
 */
export class BearerAuthProvider implements AuthProvider {
  readonly kind = "bearer";
  private readonly header: string;
  constructor(config: BearerConfig) {
    this.header = `Bearer ${config.token}`;
  }
  async getHeaders(): Promise<Record<string, string>> {
    return { Authorization: this.header };
  }
  invalidate(): void {
    /* static token: nothing to refresh */
  }
}

/**
 * HTTP Basic username:password. Used by the legacy/on-prem classic Nexthink Web
 * API. Credentials are static, so invalidation is a no-op.
 */
export class BasicAuthProvider implements AuthProvider {
  readonly kind = "basic";
  private readonly header: string;
  constructor(config: BasicConfig) {
    const encoded = Buffer.from(
      `${config.username}:${config.password}`,
      "utf8"
    ).toString("base64");
    this.header = `Basic ${encoded}`;
  }
  async getHeaders(): Promise<Record<string, string>> {
    return { Authorization: this.header };
  }
  invalidate(): void {
    /* static credentials: nothing to refresh */
  }
}
