#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { NexthinkClient } from "./nexthinkClient.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

/**
 * Entry point: load config, build the client + MCP server, and serve over stdio.
 *
 * All human-readable diagnostics go to stderr so they never corrupt the
 * JSON-RPC stream on stdout.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const client = new NexthinkClient(config);
  const server = createServer(client, config);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(
    `${SERVER_NAME} v${SERVER_VERSION} running on stdio ` +
      `(instance: ${config.instanceUrl}, mode: ${config.readOnly ? "read-only" : "read-write"})`
  );
}

main().catch((err) => {
  console.error("Fatal error starting Nexthink MCP server:", err);
  process.exit(1);
});
