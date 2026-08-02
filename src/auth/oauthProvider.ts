import axios from "axios";
import type { AuthProvider } from "./types.js";
import type { OAuthConfig } from "../config.js";
import { AuthError } from "../errors.js";
import type { Logger } from "../logger.js";

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
}

/** Seconds of safety margin before real expiry at which we proactively refresh. */
const EXPIRY_MARGIN_SEC = 60;

/**
 * OAuth 2.0 Client Credentials provider for Nexthink Infinity.
 *
 * Supports both credential-presentation modes:
 *  - `oauth2_basic`: clientId:clientSecret in the HTTP Basic header (official).
 *  - `oauth2_post`:  clientId/clientSecret in the form body (client_secret_post).
 *
 * Features: in-memory token cache, proactive refresh (60s margin), and a
 * single-flight guard so concurrent tool calls trigger at most one token
 * request against the identity endpoint.
 */
export class OAuthClientCredentialsProvider implements AuthProvider {
  readonly kind: string;
  private token: string | null = null;
  private expiresAt = 0; // epoch seconds
  private inflight: Promise<string> | null = null;

  constructor(
    private readonly config: OAuthConfig,
    private readonly timeoutMs: number,
    private readonly logger: Logger,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000)
  ) {
    this.kind = config.type;
  }

  async getHeaders(): Promise<Record<string, string>> {
    const token = await this.getToken();
    return { Authorization: `Bearer ${token}` };
  }

  invalidate(): void {
    this.token = null;
    this.expiresAt = 0;
  }

  private async getToken(): Promise<string> {
    if (this.token && this.expiresAt > this.now() + EXPIRY_MARGIN_SEC) {
      return this.token;
    }
    // Single-flight: coalesce concurrent refreshes into one request.
    if (!this.inflight) {
      this.inflight = this.fetchToken().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async fetchToken(): Promise<string> {
    const body = new URLSearchParams();
    body.append("grant_type", "client_credentials");
    body.append("scope", this.config.scope);

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    };

    if (this.config.type === "oauth2_basic") {
      const encoded = Buffer.from(
        `${this.config.clientId}:${this.config.clientSecret}`,
        "utf8"
      ).toString("base64");
      headers.Authorization = `Basic ${encoded}`;
    } else {
      // client_secret_post
      body.append("client_id", this.config.clientId);
      body.append("client_secret", this.config.clientSecret);
    }

    try {
      const res = await axios.post<TokenResponse>(this.config.tokenUrl, body, {
        headers,
        timeout: this.timeoutMs,
      });
      const data = res.data;
      if (!data?.access_token) {
        throw new AuthError("Token endpoint returned no access_token", res.status, data);
      }
      this.token = data.access_token;
      this.expiresAt = this.now() + (data.expires_in ?? 3600);
      this.logger.debug("Acquired OAuth token", {
        kind: this.kind,
        expires_in: data.expires_in ?? 3600,
      });
      return this.token;
    } catch (err) {
      this.invalidate();
      if (err instanceof AuthError) throw err;
      if (axios.isAxiosError(err)) {
        throw new AuthError(
          `OAuth token exchange failed (HTTP ${err.response?.status ?? "?"})`,
          err.response?.status,
          err.response?.data ?? err.message
        );
      }
      throw new AuthError(
        `OAuth token exchange failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
