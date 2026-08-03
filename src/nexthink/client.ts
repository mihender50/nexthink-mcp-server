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

export interface NqlExecuteResult extends NormalizedNqlResponse {
  /** True when `maxRows` trimmed the rows the API actually returned. */
  truncated?: boolean;
}

export interface ExportResult {
  export_id: string;
  raw: unknown;
}

export interface ExportStatusResult {
  status: string;
  results_file_url?: string;
  error_description?: string;
  raw: unknown;
}

export interface RemoteActionResult {
  request_id: string;
  target_count: number;
  expires_in_minutes?: number;
  raw: unknown;
}

export interface WorkflowResult {
  request_uuid: string;
  execution_uuids: string[];
  target_count: number;
  raw: unknown;
}

/** Compression modes accepted by the NQL export endpoint. */
export const EXPORT_COMPRESSIONS = ["NONE", "GZIP", "ZSTD"] as const;
export type ExportCompression = (typeof EXPORT_COMPRESSIONS)[number];

/** The `queryId` format enforced by the NQL API (`NqlApiExecuteRequest`). */
export const QUERY_ID_PATTERN = /^#[a-z0-9_]{2,255}$/;

/**
 * Normalizes and validates a saved-query id.
 *
 * The API is strict: `^#[a-z0-9_]{2,255}$`. Models routinely drop the leading
 * `#`, so we add it rather than round-trip a 400. Anything else is rejected
 * locally with a message that explains the saved-query requirement, because a
 * raw HTTP 400 gives the model nothing to correct against.
 */
export function normalizeQueryId(raw: string): string {
  const trimmed = raw.trim();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  if (!QUERY_ID_PATTERN.test(withHash)) {
    throw new NexthinkApiError(
      `"${raw}" is not a valid NQL API query id. Ids must match ` +
        `${QUERY_ID_PATTERN.source} (e.g. "#devices_with_high_crashes"). ` +
        "Note this is the id of a query saved in the Nexthink web UI " +
        "(Administration > Content management > NQL API queries), not NQL " +
        "query text — the API cannot execute ad-hoc NQL.",
      { status: 400 }
    );
  }
  return withHash;
}

/**
 * Parameter keys are sent without the leading `$` that names them inside the
 * saved query's where-clause (per `NqlApiExecuteRequest`), so strip it if the
 * caller passed the in-query spelling.
 *
 * Stripping can make two distinct keys collide (`$region` and `region`). That
 * must not resolve silently by property order — the same inputs in a different
 * order would then run different queries against production telemetry — so a
 * collision is an error the model can correct.
 */
function normalizeParameters(
  params: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!params) return undefined;
  const entries = Object.entries(params);
  if (entries.length === 0) return undefined;

  const seen = new Set<string>();
  const normalized: Array<[string, string]> = [];
  for (const [rawKey, value] of entries) {
    const key = rawKey.startsWith("$") ? rawKey.slice(1) : rawKey;
    if (!key) {
      throw new NexthinkApiError(
        `Parameter name "${rawKey}" is empty once the leading "$" is removed. ` +
          "Use the parameter's name as declared in the saved query, e.g. " +
          '"device_name" for a query referencing $device_name.',
        { status: 400 }
      );
    }
    if (seen.has(key)) {
      throw new NexthinkApiError(
        `Parameter "${key}" was supplied more than once (keys are compared ` +
          'after the leading "$" is removed, so "$' +
          `${key}" and "${key}" are the same parameter). Pass it once.`,
        { status: 400 }
      );
    }
    seen.add(key);
    normalized.push([key, value]);
  }
  return Object.fromEntries(normalized);
}

/**
 * Coerces a response field to a string for output. Only primitives are
 * accepted: `String({})` would yield "[object Object]", and handing an agent a
 * download URL of "[object Object]" is worse than an obviously-absent value.
 */
function str(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return String(value);
  return "";
}

/**
 * Typed façade over the Nexthink public REST APIs, built on the resilient
 * {@link NexthinkHttp} transport. Endpoint paths are taken from config so
 * on-prem/proxied deployments and API-version pins are supported.
 *
 * Real endpoint contracts (Nexthink Infinity, docs.nexthink.com/api):
 *  - NQL execute v2:   POST /api/v2/nql/execute  {queryId, parameters?}
 *                        -> {queryId, executedQuery, rows, executionDateTime, data[]}
 *  - NQL export:       POST /api/v1/nql/export   {queryId, parameters?, compression?}
 *                        -> {exportId}
 *  - NQL export status:GET  /api/v1/nql/status/{exportId}
 *                        -> {status, resultsFileUrl?, errorDescription?}
 *  - Remote actions:   POST /api/v1/act/execute  {remoteActionId, devices[], params, ...}
 *                        -> {requestId, expiresInMinutes?}
 *  - Workflows:        POST /api/v1/workflows/execute {workflowId, devices[], users[], params?}
 *                        -> {requestUuid, executionsUuids[]}
 *
 * NOTE on NQL: both `execute` and `export` take the **id of a query saved in
 * the Nexthink web UI**, never NQL text. There is no public endpoint that runs
 * ad-hoc NQL, so agents can only replay queries an administrator has authored
 * (optionally substituting where-clause parameters).
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
   * Executes a saved NQL API query synchronously.
   *
   * `maxRows` is a **client-side** trim that protects the model's context; it
   * cannot change what the API computes. Server-side row limits belong in the
   * saved query's own `| limit N` clause.
   */
  async executeNql(
    queryId: string,
    parameters?: Record<string, string>,
    maxRows?: number
  ): Promise<NqlExecuteResult> {
    const body: Record<string, unknown> = { queryId: normalizeQueryId(queryId) };
    const params = normalizeParameters(parameters);
    if (params) body.parameters = params;

    const raw = await this.http.request({
      method: "POST",
      path: this.config.endpoints.nqlExecute,
      body,
      context: "NQL execute",
    });

    const normalized = normalizeNqlResponse(raw);
    if (maxRows !== undefined && normalized.results.length > maxRows) {
      this.logger.debug("Truncating NQL results client-side", {
        returned: normalized.results.length,
        max_rows: maxRows,
      });
      return { ...normalized, results: normalized.results.slice(0, maxRows), truncated: true };
    }
    return normalized;
  }

  /** Schedules an asynchronous bulk export of a saved NQL API query. */
  async exportNqlAsync(
    queryId: string,
    parameters?: Record<string, string>,
    compression?: ExportCompression
  ): Promise<ExportResult> {
    const body: Record<string, unknown> = { queryId: normalizeQueryId(queryId) };
    const params = normalizeParameters(parameters);
    if (params) body.parameters = params;
    if (compression) body.compression = compression;

    const raw = (await this.http.request({
      method: "POST",
      path: this.config.endpoints.nqlExport,
      body,
      context: "NQL export",
    })) as Record<string, unknown>;

    // A response with no usable handle is an error rather than a success the
    // caller cannot act on: the whole point of this call is the id to poll,
    // and returning "" only fails later and more confusingly.
    //
    // Note this request DID schedule work server-side, so an export may now be
    // running that nobody can retrieve. That is the deliberate trade against
    // the destructive tools below, which degrade instead of throwing: an
    // orphaned read-only export is recoverable waste, whereas a script re-run
    // on real endpoints is not. No synthetic HTTP status is attached — the API
    // returned 2xx, and rendering a fake 5xx would read as transient and
    // invite a re-POST that schedules a second export.
    const exportId = str(raw?.exportId);
    if (!exportId) {
      throw new NexthinkApiError(
        "NQL export was accepted but the response contained no exportId, so " +
          "there is no handle to poll. An export may still have been scheduled " +
          "— check existing exports before retrying, or a duplicate will be " +
          `created. Raw response: ${JSON.stringify(raw)}`,
        { details: raw }
      );
    }
    return { export_id: exportId, raw };
  }

  /**
   * Polls a previously-scheduled export; returns the download URL once COMPLETED.
   *
   * Unlike {@link exportNqlAsync} this degrades rather than throwing on a
   * malformed response. It yields a *state*, not a handle: an empty status
   * reads as "not ready / unknown", and the natural response — poll again — is
   * safe and idempotent. There is nothing to lose and nothing to duplicate.
   */
  async getExportStatus(exportId: string): Promise<ExportStatusResult> {
    const path = `${this.config.endpoints.nqlStatus}/${encodeURIComponent(exportId)}`;
    const raw = (await this.http.request({
      method: "GET",
      path,
      context: "NQL export status",
    })) as Record<string, unknown>;

    const result: ExportStatusResult = { status: str(raw?.status), raw };
    if (raw?.resultsFileUrl != null) result.results_file_url = str(raw.resultsFileUrl);
    if (raw?.errorDescription != null) result.error_description = str(raw.errorDescription);
    return result;
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
      idempotent: false, // running a script twice on real devices is not recoverable
    })) as Record<string, unknown>;

    // A missing requestId is NOT raised as an error here, deliberately: the
    // action has already run on real devices, so the caller must be told it
    // happened. `raw` carries whatever came back.
    const result: RemoteActionResult = {
      request_id: str(raw?.requestId),
      target_count: args.devices.length,
      raw,
    };
    // Must satisfy z.number().int() in the tool's outputSchema, which is
    // validated *after* the handler returns — a fractional, non-finite or
    // out-of-range value would fail the call even though the Remote Action has
    // already executed on real devices, destroying request_id and inviting the
    // model to retry a destructive operation. Drop it instead; `raw` still
    // carries whatever the API sent.
    if (Number.isSafeInteger(raw?.expiresInMinutes)) {
      result.expires_in_minutes = raw.expiresInMinutes as number;
    }
    return result;
  }

  /**
   * Triggers an IT workflow against devices and/or users. Both target arrays
   * are always sent (empty when unused) because the API declares them required.
   */
  async triggerWorkflow(args: {
    workflowId: string;
    params?: Record<string, string>;
    devices?: string[];
    users?: string[];
  }): Promise<WorkflowResult> {
    const devices = args.devices ?? [];
    const users = args.users ?? [];
    const body: Record<string, unknown> = {
      workflowId: args.workflowId,
      devices,
      users,
    };
    if (args.params) body.params = args.params;

    const raw = (await this.http.request({
      method: "POST",
      path: this.config.endpoints.workflowExecute,
      body,
      context: "Workflow execute",
      idempotent: false, // a duplicate workflow re-prompts real users
    })) as Record<string, unknown>;

    return {
      request_uuid: str(raw?.requestUuid),
      execution_uuids: Array.isArray(raw?.executionsUuids)
        ? raw.executionsUuids.map(str).filter((id) => id !== "")
        : [],
      target_count: devices.length + users.length,
      raw,
    };
  }
}
