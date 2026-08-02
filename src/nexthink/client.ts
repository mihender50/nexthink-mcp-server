import type { NexthinkConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { NexthinkHttp } from "../http/client.js";
import { NexthinkApiError } from "../errors.js";
import { normalizeNqlResponse, type NormalizedNqlResponse } from "../transform.js";

export interface TriggerInfo {
  reason?: string;
  externalSource?: string;
  externalReference?: string;
}

export interface RemoteActionResult {
  execution_id: string;
  status: string;
  target_count: number;
  raw: unknown;
}

export interface ExportResult {
  export_id: string;
  status: string;
  raw: unknown;
}

/**
 * Typed façade over the Nexthink public REST APIs, built on the resilient
 * {@link NexthinkHttp} transport. Endpoint paths are taken from config so
 * on-prem/proxied deployments and API-version pins are supported.
 *
 * Real endpoint contracts (Nexthink Infinity, developer.nexthink.com):
 *  - NQL execute v2:   POST /api/v2/nql/execute        { queryId|query }
 *  - NQL export:       POST /api/v1/nql/export         { query }         -> exportId
 *  - NQL export status:GET  /api/v1/nql/status/{id}
 *  - Remote actions:   POST /api/v1/act/execute        { remoteActionId, devices, params, ... }
 *  - Workflows:        POST /api/v1/workflows/execute  { workflowId, params, devices }
 */
export class NexthinkClient {
  private readonly http: NexthinkHttp;

  constructor(
    private readonly config: NexthinkConfig,
    http: NexthinkHttp,
    private readonly logger: Logger
  ) {
    this.http = http;
  }

  /**
   * Executes a synchronous NQL query. NQL controls row limits via a `| limit N`
   * clause; when a `limit` is supplied and the query has none, one is appended.
   */
  async executeNql(query: string, limit?: number): Promise<NormalizedNqlResponse> {
    let effectiveQuery = query;
    if (limit !== undefined && !/\blimit\b/i.test(query)) {
      const safe = Math.min(Math.max(Math.trunc(limit) || 1, 1), 1000);
      effectiveQuery = `${query.trimEnd()}\n| limit ${safe}`;
    }
    const raw = await this.http.request({
      method: "POST",
      path: this.config.endpoints.nqlExecute,
      body: { query: effectiveQuery },
      context: "NQL execute",
    });
    return normalizeNqlResponse(raw);
  }

  /** Schedules an asynchronous bulk NQL export; returns a pollable job id. */
  async exportNqlAsync(query: string): Promise<ExportResult> {
    const raw = (await this.http.request({
      method: "POST",
      path: this.config.endpoints.nqlExport,
      body: { query },
      context: "NQL export",
    })) as Record<string, unknown>;
    return {
      export_id: String(raw.exportId ?? raw.export_id ?? raw.id ?? ""),
      status: String(raw.status ?? "PENDING"),
      raw,
    };
  }

  /** Polls a previously-scheduled export by id; returns its status + download URL when ready. */
  async getExportStatus(exportId: string): Promise<unknown> {
    const path = `${this.config.endpoints.nqlStatus}/${encodeURIComponent(exportId)}`;
    return this.http.request({ method: "GET", path, context: "NQL export status" });
  }

  /** Triggers a Remote Action on a set of devices (identified by Collector id). */
  async runRemoteAction(args: {
    remoteActionId: string;
    devices: string[];
    params?: Record<string, string>;
    expiresInMinutes?: number;
    triggerInfo?: TriggerInfo;
  }): Promise<RemoteActionResult> {
    if (
      this.config.allowedActions.length > 0 &&
      !this.config.allowedActions.includes(args.remoteActionId)
    ) {
      throw new NexthinkApiError(
        `Remote Action "${args.remoteActionId}" is not in the configured ` +
          `allow-list (NEXTHINK_ALLOWED_ACTIONS). Refusing to execute.`,
        { status: 403 }
      );
    }
    const body: Record<string, unknown> = {
      remoteActionId: args.remoteActionId,
      devices: args.devices,
      params: args.params ?? {},
    };
    if (args.expiresInMinutes !== undefined) body.expiresInMinutes = args.expiresInMinutes;
    if (args.triggerInfo) body.triggerInfo = args.triggerInfo;

    const raw = (await this.http.request({
      method: "POST",
      path: this.config.endpoints.actExecute,
      body,
      context: "Remote Action execute",
    })) as Record<string, unknown>;

    return {
      execution_id: String(raw.executionId ?? raw.execution_id ?? raw.id ?? ""),
      status: String(raw.status ?? "QUEUED"),
      target_count: args.devices.length,
      raw,
    };
  }

  /** Triggers an IT workflow, optionally targeting devices and passing params. */
  async triggerWorkflow(args: {
    workflowId: string;
    params?: Record<string, string>;
    devices?: string[];
  }): Promise<{ execution_id: string; status: string; raw: unknown }> {
    const body: Record<string, unknown> = { workflowId: args.workflowId };
    if (args.params) body.params = args.params;
    if (args.devices) body.devices = args.devices;

    const raw = (await this.http.request({
      method: "POST",
      path: this.config.endpoints.workflowExecute,
      body,
      context: "Workflow execute",
    })) as Record<string, unknown>;

    return {
      execution_id: String(raw.executionId ?? raw.execution_id ?? raw.id ?? ""),
      status: String(raw.status ?? "QUEUED"),
      raw,
    };
  }
}
