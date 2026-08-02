import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import { BearerAuthProvider, BasicAuthProvider } from "../src/auth/staticProviders.js";
import { OAuthClientCredentialsProvider } from "../src/auth/oauthProvider.js";
import { Logger } from "../src/logger.js";
import type { OAuthConfig } from "../src/config.js";

const silent = new Logger("error");

test("BearerAuthProvider returns a Bearer header", async () => {
  const p = new BearerAuthProvider({ type: "bearer", token: "abc" });
  assert.deepEqual(await p.getHeaders(), { Authorization: "Bearer abc" });
});

test("BasicAuthProvider base64-encodes user:pass", async () => {
  const p = new BasicAuthProvider({ type: "basic", username: "u", password: "p" });
  const expected = "Basic " + Buffer.from("u:p").toString("base64");
  assert.deepEqual(await p.getHeaders(), { Authorization: expected });
});

interface Captured {
  count: number;
  lastAuth?: string;
  lastBody?: string;
}

async function withTokenServer(
  handler: (req: http.IncomingMessage, body: string) => { status: number; json: unknown },
  fn: (url: string, captured: Captured) => Promise<void>
): Promise<void> {
  const captured: Captured = { count: 0 };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      captured.count++;
      captured.lastAuth = req.headers.authorization;
      captured.lastBody = body;
      const { status, json } = handler(req, body);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  try {
    await fn(`http://127.0.0.1:${port}/token`, captured);
  } finally {
    server.close();
  }
}

function oauthConfig(tokenUrl: string, type: OAuthConfig["type"]): OAuthConfig {
  return { type, clientId: "cid", clientSecret: "sec", scope: "service:integration", tokenUrl };
}

test("oauth2_basic sends Basic-header credentials and caches the token", async () => {
  await withTokenServer(
    () => ({ status: 200, json: { access_token: "T1", expires_in: 3600 } }),
    async (url, cap) => {
      const p = new OAuthClientCredentialsProvider(
        oauthConfig(url, "oauth2_basic"),
        5000,
        silent
      );
      const h1 = await p.getHeaders();
      const h2 = await p.getHeaders();
      assert.equal(h1.Authorization, "Bearer T1");
      assert.equal(h2.Authorization, "Bearer T1");
      assert.equal(cap.count, 1, "token cached across calls");
      assert.equal(cap.lastAuth, "Basic " + Buffer.from("cid:sec").toString("base64"));
    }
  );
});

test("oauth2_post sends credentials in the form body", async () => {
  await withTokenServer(
    () => ({ status: 200, json: { access_token: "T2", expires_in: 3600 } }),
    async (url, cap) => {
      const p = new OAuthClientCredentialsProvider(
        oauthConfig(url, "oauth2_post"),
        5000,
        silent
      );
      await p.getHeaders();
      assert.match(cap.lastBody ?? "", /client_id=cid/);
      assert.match(cap.lastBody ?? "", /client_secret=sec/);
      assert.match(cap.lastBody ?? "", /grant_type=client_credentials/);
      assert.equal(cap.lastAuth, undefined, "no Basic header in post mode");
    }
  );
});

test("concurrent getHeaders() coalesce into a single token request (single-flight)", async () => {
  await withTokenServer(
    () => ({ status: 200, json: { access_token: "T3", expires_in: 3600 } }),
    async (url, cap) => {
      const p = new OAuthClientCredentialsProvider(
        oauthConfig(url, "oauth2_basic"),
        5000,
        silent
      );
      const results = await Promise.all([p.getHeaders(), p.getHeaders(), p.getHeaders()]);
      assert.equal(cap.count, 1, "only one token request for concurrent callers");
      for (const r of results) assert.equal(r.Authorization, "Bearer T3");
    }
  );
});

test("invalidate() forces a fresh token fetch", async () => {
  await withTokenServer(
    () => ({ status: 200, json: { access_token: "T4", expires_in: 3600 } }),
    async (url, cap) => {
      const p = new OAuthClientCredentialsProvider(
        oauthConfig(url, "oauth2_basic"),
        5000,
        silent
      );
      await p.getHeaders();
      p.invalidate();
      await p.getHeaders();
      assert.equal(cap.count, 2, "invalidate triggers re-fetch");
    }
  );
});

test("proactive refresh when token is within the 60s expiry margin", async () => {
  // expires_in=30 (< 60s margin) means the cache is never considered valid,
  // so each call re-fetches.
  await withTokenServer(
    () => ({ status: 200, json: { access_token: "T5", expires_in: 30 } }),
    async (url, cap) => {
      const p = new OAuthClientCredentialsProvider(
        oauthConfig(url, "oauth2_basic"),
        5000,
        silent
      );
      await p.getHeaders();
      await p.getHeaders();
      assert.equal(cap.count, 2, "near-expiry token is refreshed each call");
    }
  );
});
