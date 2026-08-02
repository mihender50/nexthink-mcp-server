import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * MCP tool definitions (name, description, JSON Schema).
 *
 * Mutating tools carry an `annotations` block so MCP clients can enforce
 * human-in-the-loop approval. `destructiveHint` / `readOnlyHint` follow the
 * MCP tool-annotation convention.
 */

export const EXECUTE_NQL: Tool = {
  name: "execute_nql",
  description:
    "Execute a Nexthink Query Language (NQL) query to gather real-time endpoint " +
    "metrics and telemetry (device health, binary executions, crashes, network " +
    "connections, user context). Read the nexthink://schema/nql-reference resource " +
    "first to author valid syntax. Returns up to `limit` rows synchronously.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "The NQL query string to execute (e.g., 'devices during past 24h | list device.name, device.hardware.memory').",
      },
      limit: {
        type: "integer",
        description:
          "Maximum number of records to return in synchronous mode. Max value is 1000.",
        default: 100,
        minimum: 1,
        maximum: 1000,
      },
    },
    required: ["query"],
  },
  annotations: {
    title: "Execute NQL Query",
    readOnlyHint: true,
    openWorldHint: true,
  },
};

export const RUN_REMOTE_ACTION: Tool = {
  name: "run_remote_action",
  description:
    "Trigger a pre-configured Nexthink Remote Action (PowerShell/Bash remediation " +
    "script, e.g. clear disk space, restart a service) on one or more target devices. " +
    "DESTRUCTIVE: this changes state on real endpoints. Clients SHOULD require explicit " +
    "human approval before invoking.",
  inputSchema: {
    type: "object",
    properties: {
      action_id: {
        type: "string",
        description: "The unique UID or identifier of the Remote Action to execute.",
      },
      device_ids: {
        type: "array",
        description:
          "List of Nexthink Device UIDs or Hostnames on which to execute the action.",
        items: { type: "string" },
        minItems: 1,
      },
      parameters: {
        type: "object",
        description:
          "Optional key-value parameters passed to the PowerShell/Bash execution context.",
        additionalProperties: { type: "string" },
      },
    },
    required: ["action_id", "device_ids"],
  },
  annotations: {
    title: "Run Remote Action",
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
};

export const TRIGGER_WORKFLOW: Tool = {
  name: "trigger_workflow",
  description:
    "Trigger a defined Nexthink IT Workflow or user engagement campaign (e.g. prompt a " +
    "user to reboot after patch install, or run a survey). Affects end-user experience; " +
    "clients SHOULD require human approval before invoking.",
  inputSchema: {
    type: "object",
    properties: {
      workflow_id: {
        type: "string",
        description: "The unique UID of the targeted workflow.",
      },
      target_user_sids: {
        type: "array",
        description: "List of user SIDs or UPNs to target.",
        items: { type: "string" },
        minItems: 1,
      },
      context_variables: {
        type: "object",
        description: "Key-value context dictionary passed into the campaign prompt.",
        additionalProperties: { type: "string" },
      },
    },
    required: ["workflow_id", "target_user_sids"],
  },
  annotations: {
    title: "Trigger Workflow / Campaign",
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
};

export const EXPORT_NQL_ASYNC: Tool = {
  name: "export_nql_async",
  description:
    "Schedule a large-scale asynchronous NQL data extract for bulk historical telemetry. " +
    "Returns an export job id (and status) that can be polled/downloaded out of band. " +
    "Use this instead of execute_nql when the result set exceeds 1000 rows.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The NQL query to execute for batch export.",
      },
      format: {
        type: "string",
        enum: ["csv", "json"],
        default: "json",
      },
      compression: {
        type: "string",
        enum: ["gzip", "zstd"],
        default: "gzip",
      },
    },
    required: ["query"],
  },
  annotations: {
    title: "Export NQL (Async)",
    readOnlyHint: true,
    openWorldHint: true,
  },
};

/** All read-only tools (always registered). */
export const READ_TOOLS: Tool[] = [EXECUTE_NQL, EXPORT_NQL_ASYNC];

/** Mutating tools (registered unless the server runs in read-only mode). */
export const WRITE_TOOLS: Tool[] = [RUN_REMOTE_ACTION, TRIGGER_WORKFLOW];
