import axios, { AxiosError, AxiosInstance } from "axios";
import type { NexthinkConfig } from "./config.js";
import {
  transformNexthinkTabularResponse,
  type NormalizedNqlResponse,
  type RawNqlResponse,
} from "./transform.js";

/**
 * Structured error thrown for any failed Nexthink API interaction.
 * Carries the HTTP status and (when available) the raw error body so the
 * MCP layer can surface actionable messages — e.g. NQL syntax errors — back
 * to the LLM for a self-correction pass.
 */
export class NexthinkApiError extends Error {
  readonly status?: number;
  readonly details?: unknown;

  constructor(message: string, status?: number, details?: unknown) {
    super(message);
    this.name = "NexthinkApiError";
    this.status = status;
    this.details = details;
  }
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export interface RemoteActionResult {
  execution_id: string;
  status: string;
  target_count: number;
}

export interface WorkflowResult {
  execution_id: string;
  status: string;
  target_count: number;
}

export interface ExportResult {
  export_id: string;
  status: string;
}

/**
 * Thin, typed wrapper over the Nexthink public REST APIs.
 *
 * Responsibilities:
 *  - OAuth 2.0 Client Credentials token exchange, in-memory caching, and
 *    proactive refresh (60s safety margin before expiry).
 *  - A single-flight mutex so concurrent tool calls never trigger a token
 *    stampede against `/api/v1/token`.
 *  - Normalizing tabular NQL responses into key-value records.
 *  - Uniform error translation into {@link NexthinkApiError}.
 */
export class NexthinkClient {
  private readonly http: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0; // epoch seconds
  private inflightToken: Promise<string> | null = null;

  constructor(private readonly config: NexthinkConfig) {
    this.http = axios.create({
      baseURL: config.instanceUrl,
      timeout: config.httpTimeoutMs,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
    });
  }

  /** Returns a valid bearer token, refreshing if missing/near-expiry. */
  private async getAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.accessToken && this.tokenExpiresAt > now + 60) {
      return this.accessToken;
    }
    // Single-flight: coalesce concurrent refreshes into one HTTP request.
    if (!this.inflightToken) {
      this.inflightToken = this.fetchToken().finally(() => {
        this.inflightToken = null;
      });
    }
    return this.inflightToken;
  }

  private async fetchToken(): Promise<string> {
    const body = new URLSearchParams();
    body.append("grant_type", "client_credentials");
    body.append("client_id", this.config.clientId);
    body.append("client_secret", this.config.clientSecret);

    try {
      const res = await axios.post<TokenResponse>(
        `${this.config.instanceUrl}/api/v1/token`,
        body,
        {
          timeout: this.config.httpTimeoutMs,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }
      );
      const now = Math.floor(Date.now() / 1000);
      this.accessToken = res.data.access_token;
      this.tokenExpiresAt = now + (res.data.expires_in ?? 3600);
      return this.accessToken;
    } catch (err) {
      // Reset cache so the next call retries cleanly.
      this.accessToken = null;
      this.tokenExpiresAt = 0;
      throw this.toApiError(err, "OAuth token exchange failed");
    }
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    return { Authorization: `Bearer ${token}` };
  }

  /** Translates any thrown value into a {@link NexthinkApiError}. */
  private toApiError(err: unknown, context: string): NexthinkApiError {
    if (axios.isAxiosError(err)) {
      const axErr = err as AxiosError;
      const status = axErr.response?.status;
      const details = axErr.response?.data ?? axErr.message;
      const detailText =
        typeof details === "string" ? details : JSON.stringify(details);
      return new NexthinkApiError(
        `${context}${status ? ` (HTTP ${status})` : ""}: ${detailText}`,
        status,
        details
      );
    }
    return new NexthinkApiError(
      `${context}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  /**
   * Executes a synchronous NQL query and returns normalized key-value records.
   * @param query NQL query string.
   * @param limit Max rows (1-1000). Clamped to the valid range.
   */
  async executeNql(query: string, limit = 100): Promise<NormalizedNqlResponse> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit) || 1, 1), 1000);
    try {
      const res = await this.http.post<RawNqlResponse>(
        "/api/v2/nql/execute",
        { query, limit: safeLimit },
        { headers: await this.authHeaders() }
      );
      return transformNexthinkTabularResponse(res.data);
    } catch (err) {
      throw this.toApiError(err, "NQL execution failed");
    }
  }

  /**
   * Triggers a pre-configured Remote Action on one or more devices.
   */
  async runRemoteAction(
    actionId: string,
    deviceIds: string[],
    parameters: Record<string, string> = {}
  ): Promise<RemoteActionResult> {
    if (
      this.config.allowedActions.length > 0 &&
      !this.config.allowedActions.includes(actionId)
    ) {
      throw new NexthinkApiError(
        `Remote Action "${actionId}" is not in the configured allow-list ` +
          `(NEXTHINK_ALLOWED_ACTIONS). Refusing to execute.`,
        403
      );
    }
    try {
      const res = await this.http.post(
        "/api/v1/act/remote-action",
        { actionId, targets: { deviceIds }, parameters },
        { headers: await this.authHeaders() }
      );
      const data = res.data ?? {};
      return {
        execution_id: data.executionId ?? data.execution_id ?? "",
        status: data.status ?? "QUEUED",
        target_count: data.targetCount ?? data.target_count ?? deviceIds.length,
      };
    } catch (err) {
      throw this.toApiError(err, "Remote Action execution failed");
    }
  }

  /**
   * Triggers a Nexthink IT workflow or engagement campaign for target users.
   */
  async triggerWorkflow(
    workflowId: string,
    targetUserSids: string[],
    contextVariables: Record<string, string> = {}
  ): Promise<WorkflowResult> {
    try {
      const res = await this.http.post(
        "/api/v1/act/workflow",
        { workflowId, targets: { userSids: targetUserSids }, context: contextVariables },
        { headers: await this.authHeaders() }
      );
      const data = res.data ?? {};
      return {
        execution_id: data.executionId ?? data.execution_id ?? "",
        status: data.status ?? "QUEUED",
        target_count:
          data.targetCount ?? data.target_count ?? targetUserSids.length,
      };
    } catch (err) {
      throw this.toApiError(err, "Workflow trigger failed");
    }
  }

  /**
   * Schedules an asynchronous bulk NQL export and returns a pollable job id.
   */
  async exportNqlAsync(
    query: string,
    format: "csv" | "json" = "json",
    compression: "gzip" | "zstd" = "gzip"
  ): Promise<ExportResult> {
    try {
      const res = await this.http.post(
        "/api/v1/nql/export",
        { query, format, compression },
        { headers: await this.authHeaders() }
      );
      const data = res.data ?? {};
      return {
        export_id: data.exportId ?? data.export_id ?? "",
        status: data.status ?? "PENDING",
      };
    } catch (err) {
      throw this.toApiError(err, "NQL async export failed");
    }
  }
}
