import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import { NexthinkHttp, parseRetryAfterMs, computeBackoffMs } from "../src/http/client.js";
import { NexthinkApiError } from "../src/errors.js";
import { BearerAuthProvider } from "../src/auth/staticProviders.js";
import { Logger } from "../src/logger.js";
import type { NexthinkConfig } from "../src/config.js";

const silent = new Logger("error");

test("parseRetryAfterMs parses delta-seconds", () => {
  assert.equal(parseRetryAfterMs("2"), 2000);
  assert.equal(parseRetryAfterMs("0"), 0);
  assert.equal(parseRetryAfterMs("abc"), null);
  assert.equal(parseRetryAfterMs(undefined), null);
});

test("computeBackoffMs is bounded by full-jitter cap", () => {
  const retry = { maxRetries: 5, baseDelayMs: 100, maxDelayMs: 2000 };
  // rand()=1 -> exactly the cap for that attempt
  assert.equal(computeBackoffMs(0, retry, () => 1), 100);
  assert.equal(computeBackoffMs(1, retry, () => 1), 200);
  assert.equal(computeBackoffMs(10, retry, () => 1), 2000); // capped
  assert.equal(computeBackoffMs(3, retry, () => 0), 0); // rand()=0 floor
});

function cfg(baseURL: string): NexthinkConfig {
  return {
    apiBaseUrl: baseURL,
    auth: { type: "bearer", token: "t" },
    endpoints: {
      nqlExecute: "/api/v2/nql/execute",
      nqlExport: "/api/v1/nql/export",
      nqlStatus: "/api/v1/nql/status",
      actExecute: "/api/v1/act/execute",
      workflowExecute: "/api/v1/workflows/execute",
      campaignTrigger: "/api/v1/campaigns/trigger",
    },
    allowedActions: [],
    readOnly: false,
    httpTimeoutMs: 5000,
    retry: { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5 },
    logLevel: "error",
  };
}

async function withServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, hit: number) => void,
  fn: (baseURL: string) => Promise<void>
): Promise<void> {
  let hits = 0;
  const server = http.createServer((req, res) => handler(req, res, ++hits));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

test("retries 5xx then succeeds", async () => {
  await withServer(
    (_req, res, hit) => {
      if (hit < 3) {
        res.writeHead(500);
        res.end("boom");
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, hit }));
      }
    },
    async (baseURL) => {
      const http_ = new NexthinkHttp(cfg(baseURL), new BearerAuthProvider({ type: "bearer", token: "t" }), silent, () => 0);
      const out = (await http_.request({ method: "GET", path: "/api/v2/nql/execute", context: "test" })) as { ok: boolean; hit: number };
      assert.equal(out.ok, true);
      assert.equal(out.hit, 3);
    }
  );
});

test("honors Retry-After on 429 and eventually succeeds", async () => {
  await withServer(
    (_req, res, hit) => {
      if (hit === 1) {
        res.writeHead(429, { "Retry-After": "0" });
        res.end("slow down");
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      }
    },
    async (baseURL) => {
      const http_ = new NexthinkHttp(cfg(baseURL), new BearerAuthProvider({ type: "bearer", token: "t" }), silent, () => 0);
      const out = (await http_.request({ method: "GET", path: "/x", context: "test" })) as { ok: boolean };
      assert.equal(out.ok, true);
    }
  );
});

test("gives up after maxRetries and throws a typed retryable error", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(503);
      res.end("unavailable");
    },
    async (baseURL) => {
      const http_ = new NexthinkHttp(cfg(baseURL), new BearerAuthProvider({ type: "bearer", token: "t" }), silent, () => 0);
      await assert.rejects(
        http_.request({ method: "GET", path: "/x", context: "test" }),
        (err: unknown) => {
          assert.ok(err instanceof NexthinkApiError);
          assert.equal(err.status, 503);
          assert.equal(err.retryable, true);
          return true;
        }
      );
    }
  );
});

test("does not retry a 400 and surfaces the body for self-correction", async () => {
  let hits = 0;
  await withServer(
    (_req, res) => {
      hits++;
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "bad NQL syntax near '|'" }));
    },
    async (baseURL) => {
      const http_ = new NexthinkHttp(cfg(baseURL), new BearerAuthProvider({ type: "bearer", token: "t" }), silent, () => 0);
      await assert.rejects(
        http_.request({ method: "POST", path: "/api/v2/nql/execute", body: {}, context: "NQL execute" }),
        (err: unknown) => {
          assert.ok(err instanceof NexthinkApiError);
          assert.equal(err.status, 400);
          assert.equal(err.retryable, false);
          assert.match(err.message, /bad NQL syntax/);
          return true;
        }
      );
      assert.equal(hits, 1, "400 is not retried");
    }
  );
});
