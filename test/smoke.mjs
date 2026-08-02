// Standalone smoke test: launch the built server over stdio and verify the
// MCP handshake, tool list, resource list, and read-only mode. No network.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";

async function connect(env) {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: { ...process.env, ...env },
    stderr: "ignore",
  });
  const client = new Client({ name: "smoke", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

const baseEnv = {
  NEXTHINK_INSTANCE: "acme",
  NEXTHINK_REGION: "eu",
  NEXTHINK_AUTH_TYPE: "bearer",
  NEXTHINK_BEARER_TOKEN: "smoke-token",
};

// Read-write mode: all 5 tools present.
{
  const client = await connect(baseEnv);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "execute_nql",
    "export_nql_async",
    "get_nql_export_status",
    "run_remote_action",
    "trigger_workflow",
  ]);
  // outputSchema + destructive annotation present on the mutating tool.
  const ra = tools.find((t) => t.name === "run_remote_action");
  assert.ok(ra.outputSchema, "run_remote_action has outputSchema");
  assert.equal(ra.annotations?.destructiveHint, true);
  const nql = tools.find((t) => t.name === "execute_nql");
  assert.equal(nql.annotations?.readOnlyHint, true);
  assert.ok(nql.outputSchema, "execute_nql has outputSchema");

  const { resources } = await client.listResources();
  assert.ok(resources.some((r) => r.uri === "nexthink://schema/nql-reference"));
  const read = await client.readResource({ uri: "nexthink://schema/nql-reference" });
  assert.match(read.contents[0].text, /NQL/);
  await client.close();
  console.log("OK: read-write mode exposes 5 tools + resource, schemas & annotations present");
}

// Read-only mode: mutating tools hidden.
{
  const client = await connect({ ...baseEnv, NEXTHINK_READ_ONLY: "true" });
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["execute_nql", "export_nql_async", "get_nql_export_status"]);
  await client.close();
  console.log("OK: read-only mode hides run_remote_action and trigger_workflow");
}

console.log("SMOKE PASSED");
