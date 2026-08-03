import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { NexthinkConfig } from "./config.js";
import { EXPORT_COMPRESSIONS, type NexthinkClient } from "./nexthink/client.js";
import { NexthinkApiError, AuthError } from "./errors.js";
import type { Logger } from "./logger.js";
import { NQL_REFERENCE } from "./resources.js";

export const SERVER_NAME = "nexthink-mcp-server";
export const SERVER_VERSION = "3.0.0";

/**
 * Shared wording for the saved-query constraint. The Nexthink NQL API executes
 * queries by id only — there is no endpoint that accepts ad-hoc NQL text — so
 * every NQL tool description has to make that unmistakable to the model.
 */
const SAVED_QUERY_NOTE =
  "Takes the ID of a query saved in the Nexthink web UI (Administration > " +
  "Content management > NQL API queries), NOT NQL query text: the public API " +
  "cannot execute ad-hoc NQL. An administrator must author the query and its " +
  "parameters first; the API only replays it.";

/** Serialize any successful payload as both text and structured content. */
function ok(payload: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
  };
}

/** Map a thrown error into an MCP tool error result (surfaced to the model). */
function fail(err: unknown, logger: Logger, tool: string): CallToolResult {
  let text: string;
  if (err instanceof NexthinkApiError) {
    // Surface status + body so the model can self-correct (e.g. NQL 400).
    text = `Nexthink API error${err.status ? ` [HTTP ${err.status}]` : ""}: ${err.message}`;
  } else if (err instanceof AuthError) {
    text = `Nexthink authentication error${err.status ? ` [HTTP ${err.status}]` : ""}: ${err.message}`;
  } else {
    text = `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
  logger.error("Tool call failed", { tool, error: text });
  return { isError: true, content: [{ type: "text", text }] };
}

/**
 * Builds a fully-wired {@link McpServer} using the modern registerTool API with
 * Zod input + output schemas. Successful calls return `structuredContent`
 * validated against the output schema (MCP 2025-11-25 structured tool output),
 * with a JSON text fallback for text-only clients.
 */
export function createServer(
  client: NexthinkClient,
  config: NexthinkConfig,
  logger: Logger
): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {}, resources: {} },
      instructions:
        "Query Nexthink Digital Employee Experience telemetry and run " +
        "authorized remediations. NQL queries are executed BY ID: only queries " +
        "an administrator saved in the Nexthink web UI can be run, optionally " +
        "with where-clause parameters — ad-hoc NQL text is not supported by the " +
        "API. Read the nexthink://schema/nql-reference resource for the query " +
        "id format and how parameters are bound. Remote actions and workflows " +
        "change state on real endpoints — confirm intent before invoking.",
    }
  );

  // ---- Resource ----------------------------------------------------------
  server.registerResource(
    NQL_REFERENCE.name,
    NQL_REFERENCE.uri,
    {
      title: NQL_REFERENCE.title,
      description: NQL_REFERENCE.description,
      mimeType: NQL_REFERENCE.mimeType,
    },
    async () => ({
      contents: [
        {
          uri: NQL_REFERENCE.uri,
          mimeType: NQL_REFERENCE.mimeType,
          text: NQL_REFERENCE.text,
        },
      ],
    })
  );

  // ---- Read-only tools ---------------------------------------------------
  const queryIdInput = z
    .string()
    .min(1)
    .describe(
      "ID of a saved NQL API query, e.g. `#devices_with_high_crashes` " +
        "(pattern `^#[a-z0-9_]{2,255}$`; a leading `#` is added if omitted). " +
        SAVED_QUERY_NOTE
    );

  const parametersInput = z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Values for the saved query's parameters. Parameters are declared in the " +
        "query's where-clause as `$name`; pass keys without the `$` (a leading " +
        "`$` is stripped if present). Only parameters the saved query declares " +
        "can be substituted — this cannot add filters of your own."
    );

  server.registerTool(
    "execute_nql",
    {
      title: "Execute Saved NQL Query",
      description:
        "Run a saved Nexthink Query Language (NQL) API query for endpoint " +
        "telemetry (device health, executions, crashes, connections, users) and " +
        "return its rows. " +
        SAVED_QUERY_NOTE +
        " Read nexthink://schema/nql-reference first. Use export_nql_async for " +
        "large result sets.",
      inputSchema: {
        query_id: queryIdInput,
        parameters: parametersInput,
        max_rows: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe(
            "Client-side cap on the rows handed back, to protect context. This " +
              "does NOT change the query the API runs — server-side row limits " +
              "must be written into the saved query's own `| limit N` clause. " +
              "`truncated: true` is set when rows were dropped."
          ),
      },
      outputSchema: {
        total_rows: z.number().int(),
        results: z.array(z.record(z.string(), z.any())),
        truncated: z.boolean().optional(),
        query_id: z.string().optional(),
        executed_query: z.string().optional(),
        execution_datetime: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query_id, parameters, max_rows }) => {
      try {
        return ok(await client.executeNql(query_id, parameters, max_rows));
      } catch (err) {
        return fail(err, logger, "execute_nql");
      }
    }
  );

  server.registerTool(
    "export_nql_async",
    {
      title: "Export Saved NQL Query (Async)",
      description:
        "Schedule a bulk asynchronous export of a saved NQL API query, for " +
        "result sets too large for execute_nql. " +
        SAVED_QUERY_NOTE +
        " Returns an export id; poll it with get_nql_export_status to get the " +
        "download URL.",
      inputSchema: {
        query_id: queryIdInput,
        parameters: parametersInput,
        compression: z
          .enum(EXPORT_COMPRESSIONS)
          .optional()
          .describe(
            "Compression for the exported file. Defaults to uncompressed; " +
              "GZIP/ZSTD produce a .gz/.zst download URL that must be " +
              "decompressed before reading."
          ),
      },
      outputSchema: {
        export_id: z.string(),
        raw: z.any().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query_id, parameters, compression }) => {
      try {
        return ok(await client.exportNqlAsync(query_id, parameters, compression));
      } catch (err) {
        return fail(err, logger, "export_nql_async");
      }
    }
  );

  server.registerTool(
    "get_nql_export_status",
    {
      title: "Get NQL Export Status",
      description:
        "Poll a previously scheduled NQL export by id. Status is one of " +
        "SUBMITTED, IN_PROGRESS, COMPLETED or ERROR; when COMPLETED the result " +
        "carries `results_file_url` for the exported file, and when ERROR it " +
        "carries `error_description`.",
      inputSchema: {
        export_id: z.string().min(1).describe("The export id returned by export_nql_async."),
      },
      outputSchema: {
        status: z.string(),
        results_file_url: z.string().optional(),
        error_description: z.string().optional(),
        raw: z.any().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ export_id }) => {
      try {
        return ok(await client.getExportStatus(export_id));
      } catch (err) {
        return fail(err, logger, "get_nql_export_status");
      }
    }
  );

  // ---- Mutating tools (skipped in read-only mode) ------------------------
  if (!config.readOnly) {
    server.registerTool(
      "run_remote_action",
      {
        title: "Run Remote Action",
        description:
          "Trigger a pre-configured Nexthink Remote Action (PowerShell/Bash " +
          "remediation) on target devices, identified by Collector id " +
          "(device.collector.id in NQL). DESTRUCTIVE: changes state on real " +
          "endpoints — clients SHOULD require human approval.",
        inputSchema: {
          remote_action_id: z
            .string()
            .describe("UID/identifier of the Remote Action to execute."),
          devices: z
            .array(z.string())
            .min(1)
            .max(10000)
            .describe("Target device Collector ids (device.collector.id). Max 10000."),
          params: z
            .record(z.string(), z.string())
            .optional()
            .describe("Optional key-value parameters passed to the script."),
          expires_in_minutes: z
            .number()
            .int()
            .min(60)
            .max(10080)
            .optional()
            .describe(
              "How long the execution stays queued for devices that are offline, " +
                "in minutes. The API accepts 60-10080 (1 hour to 7 days)."
            ),
          trigger_info: z
            .object({
              reason: z.string().optional(),
              external_source: z.string().optional(),
              external_reference: z.string().optional(),
            })
            .optional()
            .describe("Optional provenance metadata for auditing."),
        },
        outputSchema: {
          request_id: z.string(),
          target_count: z.number().int(),
          expires_in_minutes: z.number().int().optional(),
          raw: z.any().optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: true,
        },
      },
      async ({ remote_action_id, devices, params, expires_in_minutes, trigger_info }) => {
        try {
          return ok(
            await client.runRemoteAction({
              remoteActionId: remote_action_id,
              devices,
              params,
              expiresInMinutes: expires_in_minutes,
              triggerInfo: trigger_info
                ? {
                    reason: trigger_info.reason,
                    externalSource: trigger_info.external_source,
                    externalReference: trigger_info.external_reference,
                  }
                : undefined,
            })
          );
        } catch (err) {
          return fail(err, logger, "run_remote_action");
        }
      }
    );

    server.registerTool(
      "trigger_workflow",
      {
        title: "Trigger Workflow",
        description:
          "Trigger a Nexthink IT workflow / engagement campaign (e.g. prompt a " +
          "user to reboot after patching) against devices and/or users. Provide " +
          "at least one target. Affects end-user experience — clients SHOULD " +
          "require human approval.",
        inputSchema: {
          workflow_id: z.string().min(1).describe("UID of the workflow to trigger."),
          params: z
            .record(z.string(), z.string())
            .optional()
            .describe("Optional key-value context passed into the workflow."),
          devices: z
            .array(z.string())
            .max(10000)
            .optional()
            .describe("Target device Collector ids (UUIDs). Max 10000."),
          users: z
            .array(z.string())
            .max(10000)
            .optional()
            .describe("Target user security ids (SIDs, e.g. `S-1-5-21-...`). Max 10000."),
        },
        outputSchema: {
          request_uuid: z.string(),
          execution_uuids: z.array(z.string()),
          target_count: z.number().int(),
          raw: z.any().optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: true,
        },
      },
      async ({ workflow_id, params, devices, users }) => {
        try {
          if (!devices?.length && !users?.length) {
            throw new NexthinkApiError(
              "trigger_workflow needs at least one target: pass `devices` " +
                "(Collector ids) and/or `users` (security ids).",
              { status: 400 }
            );
          }
          return ok(
            await client.triggerWorkflow({
              workflowId: workflow_id,
              params,
              devices,
              users,
            })
          );
        } catch (err) {
          return fail(err, logger, "trigger_workflow");
        }
      }
    );
  }

  return server;
}
