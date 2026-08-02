import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { NexthinkConfig } from "./config.js";
import type { NexthinkClient } from "./nexthink/client.js";
import { NexthinkApiError, AuthError } from "./errors.js";
import type { Logger } from "./logger.js";
import { NQL_REFERENCE } from "./resources.js";

export const SERVER_NAME = "nexthink-mcp-server";
export const SERVER_VERSION = "2.0.0";

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
        "Query Nexthink Digital Employee Experience telemetry via NQL and run " +
        "authorized remediations. Read the nexthink://schema/nql-reference " +
        "resource before writing NQL. Remote actions and workflows change state " +
        "on real endpoints — confirm intent before invoking.",
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
  server.registerTool(
    "execute_nql",
    {
      title: "Execute NQL Query",
      description:
        "Execute a Nexthink Query Language (NQL) query for real-time endpoint " +
        "telemetry (device health, executions, crashes, connections, users). " +
        "Read nexthink://schema/nql-reference first. Returns up to `limit` rows.",
      inputSchema: {
        query: z.string().describe("The NQL query to execute."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe("Max rows (1-1000). Appended as `| limit N` if the query has none."),
      },
      outputSchema: {
        total_rows: z.number().int(),
        results: z.array(z.record(z.string(), z.any())),
        query_id: z.string().optional(),
        executed_query: z.string().optional(),
        execution_datetime: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, limit }) => {
      try {
        return ok(await client.executeNql(query, limit));
      } catch (err) {
        return fail(err, logger, "execute_nql");
      }
    }
  );

  server.registerTool(
    "export_nql_async",
    {
      title: "Export NQL (Async)",
      description:
        "Schedule a bulk asynchronous NQL export (for >1000-row historical " +
        "datasets). Returns an export id; poll it with get_nql_export_status.",
      inputSchema: {
        query: z.string().describe("The NQL query to export."),
      },
      outputSchema: {
        export_id: z.string(),
        status: z.string(),
        raw: z.any().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query }) => {
      try {
        return ok(await client.exportNqlAsync(query));
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
        "Poll a previously scheduled NQL export by id. When complete, the result " +
        "includes the download URL for the exported file.",
      inputSchema: {
        export_id: z.string().describe("The export id returned by export_nql_async."),
      },
      outputSchema: { result: z.any() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ export_id }) => {
      try {
        return ok({ result: await client.getExportStatus(export_id) });
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
            .describe("Target device Collector ids (device.collector.id)."),
          params: z
            .record(z.string(), z.string())
            .optional()
            .describe("Optional key-value parameters passed to the script."),
          expires_in_minutes: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Optional execution expiry window in minutes."),
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
          execution_id: z.string(),
          status: z.string(),
          target_count: z.number().int(),
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
          "user to reboot after patching). Affects end-user experience — clients " +
          "SHOULD require human approval.",
        inputSchema: {
          workflow_id: z.string().describe("UID of the workflow to trigger."),
          params: z
            .record(z.string(), z.string())
            .optional()
            .describe("Optional key-value context passed into the workflow."),
          devices: z
            .array(z.string())
            .optional()
            .describe("Optional target device Collector ids."),
        },
        outputSchema: {
          execution_id: z.string(),
          status: z.string(),
          raw: z.any().optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: true,
        },
      },
      async ({ workflow_id, params, devices }) => {
        try {
          return ok(
            await client.triggerWorkflow({ workflowId: workflow_id, params, devices })
          );
        } catch (err) {
          return fail(err, logger, "trigger_workflow");
        }
      }
    );
  }

  return server;
}
