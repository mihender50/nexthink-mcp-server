#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { Logger } from "./logger.js";
import { createAuthProvider } from "./auth/factory.js";
import { NexthinkHttp } from "./http/client.js";
import { NexthinkClient } from "./nexthink/client.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";
import { ConfigError } from "./errors.js";

/**
 * Entry point: load config, assemble the auth → HTTP → domain → MCP stack, and
 * serve over stdio. All diagnostics go to stderr so they never corrupt the
 * JSON-RPC frame stream on stdout.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger(config.logLevel);

  const auth = createAuthProvider(config, logger);
  const http = new NexthinkHttp(config, auth, logger);
  const client = new NexthinkClient(config, http, logger);
  const server = createServer(client, config, logger);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info(`${SERVER_NAME} v${SERVER_VERSION} started`, {
    api_base_url: config.apiBaseUrl,
    auth: config.auth.type,
    mode: config.readOnly ? "read-only" : "read-write",
    protocol: "MCP 2025-11-25 (structured output)",
  });
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    process.stderr.write(`Configuration error: ${err.message}\n`);
  } else {
    process.stderr.write(
      `Fatal error starting Nexthink MCP server: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`
    );
  }
  process.exit(1);
});
