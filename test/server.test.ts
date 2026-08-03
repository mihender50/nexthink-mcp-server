/**
 * Tool-layer contract tests.
 *
 * Everything else in this suite tests a layer in isolation. This drives the
 * real `McpServer` over an in-memory transport, because one failure mode is
 * invisible below this level: `outputSchema` is validated by the SDK *after*
 * the tool handler returns, so a value the handler happily produced but the
 * schema rejects fails the call without the handler's try/catch ever seeing
 * it. The model then gets an opaque Zod error instead of its result — and for
 * a destructive tool, after the side effect has already happened.
 *
 * Every field in an outputSchema must therefore be satisfiable by the mapper
 * on every path, including malformed-response paths.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { NexthinkClient } from "../src/nexthink/client.js";
import type { NexthinkHttp } from "../src/http/client.js";
import { DEFAULT_ENDPOINTS, type NexthinkConfig } from "../src/config.js";
import { Logger } from "../src/logger.js";

const logger = new Logger("error");

const config = (over: Partial<NexthinkConfig> = {}): NexthinkConfig =>
  ({
    apiBaseUrl: "https://acme.api.eu.nexthink.cloud",
    auth: { type: "bearer", token: "t" },
    endpoints: { ...DEFAULT_ENDPOINTS },
    allowedActions: [],
    readOnly: false,
    httpTimeoutMs: 30000,
    retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
    logLevel: "error",
    ...over,
  }) as NexthinkConfig;

/** Connects a real client to a real server whose HTTP layer returns `response`. */
async function connect(response: unknown, over: Partial<NexthinkConfig> = {}) {
  const http = { request: async () => response } as unknown as NexthinkHttp;
  const server = createServer(new NexthinkClient(config(over), http, logger), config(over), logger);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, close: () => client.close() };
}

/**
 * Response bodies a gateway, proxy, or partial outage can realistically produce.
 * None may fail output-schema validation.
 */
const HOSTILE_BODIES: Array<[string, unknown]> = [
  ["null", null],
  ["undefined", undefined],
  ["empty string", ""],
  ["html error page", "<html><body>502</body></html>"],
  ["number", 42],
  ["boolean", true],
  ["array", [1, 2, 3]],
  ["empty object", {}],
  ["nested junk", { data: { nope: true }, rows: { bad: 1 } }],
  ["null metadata", { queryId: null, executedQuery: null, executionDateTime: null, data: [] }],
  ["wrong-typed metadata", { queryId: 7, executedQuery: [], executionDateTime: {}, rows: "x", data: [] }],
  ["non-finite rows", { rows: Infinity, data: [] }],
  ["huge rows", { rows: 2 ** 60, data: [] }],
  ["fractional expiry", { requestId: "r", expiresInMinutes: 1440.0000000001 }],
  ["non-finite expiry", { requestId: "r", expiresInMinutes: Infinity }],
  ["huge expiry", { requestId: "r", expiresInMinutes: 2 ** 60 }],
  ["object-valued fields", { exportId: { id: "x" }, requestId: { id: "x" }, requestUuid: { id: "x" } }],
];

const READ_CALLS = [
  { name: "execute_nql", arguments: { query_id: "#q_devices" } },
  { name: "export_nql_async", arguments: { query_id: "#q_devices" } },
  { name: "get_nql_export_status", arguments: { export_id: "exp-1" } },
];

const WRITE_CALLS = [
  { name: "run_remote_action", arguments: { remote_action_id: "act-1", devices: ["dev-a"] } },
  { name: "trigger_workflow", arguments: { workflow_id: "wf-1", devices: ["dev-a"] } },
];

for (const [label, body] of HOSTILE_BODIES) {
  test(`tool output stays schema-valid for a ${label} response`, async () => {
    const { client, close } = await connect(body);
    try {
      for (const call of [...READ_CALLS, ...WRITE_CALLS]) {
        const res = await client.callTool(call);
        const text = res.content?.[0]?.type === "text" ? res.content[0].text : "";
        // A clean tool error is fine. A schema violation is not: it means the
        // mapper produced a value its own outputSchema rejects.
        assert.doesNotMatch(
          text,
          /Output validation error|Invalid structured content/,
          `${call.name} produced schema-invalid output for a ${label} response: ${text}`
        );
        if (!res.isError) {
          assert.ok(res.structuredContent, `${call.name} succeeded without structuredContent`);
        }
      }
    } finally {
      await close();
    }
  });
}

test("run_remote_action survives a fractional expiresInMinutes after the action fired", async () => {
  // The regression this file exists for: the action has already executed, so
  // failing the call here would destroy request_id and invite a retry.
  const { client, close } = await connect({
    requestId: "3f0a-req",
    expiresInMinutes: 1440.0000000001,
  });
  try {
    const res = await client.callTool(WRITE_CALLS[0]);
    assert.notEqual(res.isError, true);
    const out = res.structuredContent as Record<string, unknown>;
    assert.equal(out.request_id, "3f0a-req");
    assert.equal(out.target_count, 1);
    assert.equal(out.expires_in_minutes, undefined, "unusable expiry is dropped, not surfaced");
  } finally {
    await close();
  }
});

test("a well-formed response round-trips through the tool layer intact", async () => {
  const { client, close } = await connect({
    queryId: "#q_devices",
    executedQuery: "devices | list device.name",
    rows: 2,
    executionDateTime: "2026-08-03T00:00:00",
    data: [{ "device.name": "HOST-1" }, { "device.name": "HOST-2" }],
  });
  try {
    const res = await client.callTool({
      name: "execute_nql",
      arguments: { query_id: "q_devices", parameters: { region: "EMEA" } },
    });
    assert.notEqual(res.isError, true);
    const out = res.structuredContent as Record<string, unknown>;
    assert.equal(out.total_rows, 2);
    assert.equal(out.query_id, "#q_devices");
    assert.deepEqual(out.results, [{ "device.name": "HOST-1" }, { "device.name": "HOST-2" }]);
  } finally {
    await close();
  }
});

test("an unusable export handle surfaces as a clean tool error", async () => {
  // The HOSTILE_BODIES loop only proves output is schema-valid, and an empty
  // export_id would satisfy the schema. This pins the actual behaviour: the
  // client's throw must reach the model as a readable isError, not as a
  // schema violation and not as a "success" carrying nothing to poll.
  const { client, close } = await connect({ status: "SUBMITTED" }); // no exportId
  try {
    const res = await client.callTool({
      name: "export_nql_async",
      arguments: { query_id: "#q_devices" },
    });
    assert.equal(res.isError, true);
    const text = res.content?.[0]?.type === "text" ? res.content[0].text : "";
    assert.match(text, /no exportId/);
    assert.match(text, /may still have been scheduled/);
    assert.doesNotMatch(text, /Output validation error/);
    assert.equal(res.structuredContent, undefined);
  } finally {
    await close();
  }
});

test("a valid export handle still round-trips", async () => {
  const { client, close } = await connect({ exportId: "exp-123" });
  try {
    const res = await client.callTool({
      name: "export_nql_async",
      arguments: { query_id: "#q_devices" },
    });
    assert.notEqual(res.isError, true);
    assert.equal((res.structuredContent as Record<string, unknown>).export_id, "exp-123");
  } finally {
    await close();
  }
});

test("an invalid query id is a clean tool error, not a schema failure", async () => {
  const { client, close } = await connect({ rows: 0, data: [] });
  try {
    const res = await client.callTool({
      name: "execute_nql",
      arguments: { query_id: "devices | list device.name" },
    });
    assert.equal(res.isError, true);
    const text = res.content?.[0]?.type === "text" ? res.content[0].text : "";
    assert.match(text, /cannot execute ad-hoc NQL/);
    assert.doesNotMatch(text, /Output validation error/);
  } finally {
    await close();
  }
});

test("the Remote Action allow-list is enforced at the tool layer", async () => {
  const { client, close } = await connect({ requestId: "r" }, { allowedActions: ["act-ok"] });
  try {
    const res = await client.callTool(WRITE_CALLS[0]);
    assert.equal(res.isError, true);
    const text = res.content?.[0]?.type === "text" ? res.content[0].text : "";
    assert.match(text, /allow-list/);
  } finally {
    await close();
  }
});

test("read-only mode hides the destructive tools from the tool layer", async () => {
  const { client, close } = await connect({ rows: 0, data: [] }, { readOnly: true });
  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    assert.equal(names.includes("run_remote_action"), false);
    assert.equal(names.includes("trigger_workflow"), false);
  } finally {
    await close();
  }
});
