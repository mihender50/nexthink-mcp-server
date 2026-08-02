import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { NexthinkConfig } from "./config.js";
import { NexthinkClient, NexthinkApiError } from "./nexthinkClient.js";
import { RESOURCES } from "./resources.js";
import { READ_TOOLS, WRITE_TOOLS } from "./tools.js";

const SERVER_NAME = "nexthink-mcp-server";
const SERVER_VERSION = "1.0.0";

function jsonResult(payload: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function errorResult(err: unknown): CallToolResult {
  let text: string;
  if (err instanceof NexthinkApiError) {
    // Surface status + body so the LLM can self-correct (e.g. NQL 400 syntax).
    text =
      `Nexthink API Error${err.status ? ` [HTTP ${err.status}]` : ""}: ${err.message}`;
  } else {
    text = `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
  return { isError: true, content: [{ type: "text", text }] };
}

/**
 * Builds a fully-wired MCP {@link Server} for a given Nexthink client + config.
 * Separated from transport/startup so it can be unit-tested in isolation.
 */
export function createServer(client: NexthinkClient, config: NexthinkConfig): Server {
  const tools = config.readOnly ? [...READ_TOOLS] : [...READ_TOOLS, ...WRITE_TOOLS];

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: {} } }
  );

  // ---- Resources ----------------------------------------------------------
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: RESOURCES.map(({ uri, name, mimeType, description }) => ({
      uri,
      name,
      mimeType,
      description,
    })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const match = RESOURCES.find((r) => r.uri === request.params.uri);
    if (!match) {
      throw new Error(`Resource not found: ${request.params.uri}`);
    }
    return {
      contents: [
        { uri: match.uri, mimeType: match.mimeType, text: match.text },
      ],
    };
  });

  // ---- Tools --------------------------------------------------------------
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const args = (rawArgs ?? {}) as Record<string, unknown>;

    try {
      switch (name) {
        case "execute_nql": {
          const query = requireString(args, "query");
          const limit = optionalNumber(args, "limit") ?? 100;
          return jsonResult(await client.executeNql(query, limit));
        }

        case "export_nql_async": {
          const query = requireString(args, "query");
          const format = (optionalString(args, "format") ?? "json") as "csv" | "json";
          const compression = (optionalString(args, "compression") ?? "gzip") as
            | "gzip"
            | "zstd";
          return jsonResult(await client.exportNqlAsync(query, format, compression));
        }

        case "run_remote_action": {
          if (config.readOnly) return readOnlyRejection(name);
          const actionId = requireString(args, "action_id");
          const deviceIds = requireStringArray(args, "device_ids");
          const parameters = optionalStringMap(args, "parameters");
          return jsonResult(
            await client.runRemoteAction(actionId, deviceIds, parameters)
          );
        }

        case "trigger_workflow": {
          if (config.readOnly) return readOnlyRejection(name);
          const workflowId = requireString(args, "workflow_id");
          const userSids = requireStringArray(args, "target_user_sids");
          const context = optionalStringMap(args, "context_variables");
          return jsonResult(
            await client.triggerWorkflow(workflowId, userSids, context)
          );
        }

        default:
          return errorResult(new Error(`Unknown tool: ${name}`));
      }
    } catch (err) {
      return errorResult(err);
    }
  });

  return server;
}

function readOnlyRejection(tool: string): CallToolResult {
  return errorResult(
    new Error(
      `Tool "${tool}" is disabled: server is running in read-only mode ` +
        `(NEXTHINK_READ_ONLY=true).`
    )
  );
}

// ---- Argument validation helpers -----------------------------------------

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`Missing or invalid required string argument: "${key}"`);
  }
  return v;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new Error(`Argument "${key}" must be a string`);
  return v;
}

function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`Argument "${key}" must be a number`);
  }
  return v;
}

function requireStringArray(args: Record<string, unknown>, key: string): string[] {
  const v = args[key];
  if (!Array.isArray(v) || v.length === 0) {
    throw new Error(`Argument "${key}" must be a non-empty array of strings`);
  }
  if (!v.every((item) => typeof item === "string")) {
    throw new Error(`All items in "${key}" must be strings`);
  }
  return v as string[];
}

function optionalStringMap(
  args: Record<string, unknown>,
  key: string
): Record<string, string> {
  const v = args[key];
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) {
    throw new Error(`Argument "${key}" must be an object of string values`);
  }
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = typeof val === "string" ? val : String(val);
  }
  return out;
}

export { SERVER_NAME, SERVER_VERSION };
