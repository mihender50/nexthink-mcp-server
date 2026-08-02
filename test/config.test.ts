import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { ConfigError } from "../src/errors.js";

const base = {
  NEXTHINK_INSTANCE: "acme",
  NEXTHINK_REGION: "eu",
  NEXTHINK_CLIENT_ID: "cid",
  NEXTHINK_CLIENT_SECRET: "secret",
};

test("derives region-partitioned API base and token URL", () => {
  const cfg = loadConfig({ ...base } as NodeJS.ProcessEnv);
  assert.equal(cfg.apiBaseUrl, "https://acme.api.eu.nexthink.cloud");
  assert.equal(cfg.auth.type, "oauth2_basic");
  if (cfg.auth.type === "oauth2_basic" || cfg.auth.type === "oauth2_post") {
    assert.equal(
      cfg.auth.tokenUrl,
      "https://acme-login.eu.nexthink.cloud/oauth2/default/v1/token"
    );
    assert.equal(cfg.auth.scope, "service:integration");
  }
});

test("rejects an unknown region", () => {
  assert.throws(
    () => loadConfig({ ...base, NEXTHINK_REGION: "mars" } as NodeJS.ProcessEnv),
    ConfigError
  );
});

test("explicit API base URL overrides instance/region derivation", () => {
  const cfg = loadConfig({
    ...base,
    NEXTHINK_API_BASE_URL: "https://proxy.internal/nexthink/",
  } as NodeJS.ProcessEnv);
  assert.equal(cfg.apiBaseUrl, "https://proxy.internal/nexthink");
});

test("bearer auth type requires a token", () => {
  assert.throws(
    () =>
      loadConfig({
        NEXTHINK_API_BASE_URL: "https://x",
        NEXTHINK_AUTH_TYPE: "bearer",
      } as NodeJS.ProcessEnv),
    ConfigError
  );
  const cfg = loadConfig({
    NEXTHINK_API_BASE_URL: "https://x",
    NEXTHINK_AUTH_TYPE: "bearer",
    NEXTHINK_BEARER_TOKEN: "tok",
  } as NodeJS.ProcessEnv);
  assert.equal(cfg.auth.type, "bearer");
});

test("basic auth type requires username and password", () => {
  const cfg = loadConfig({
    NEXTHINK_API_BASE_URL: "https://x",
    NEXTHINK_AUTH_TYPE: "basic",
    NEXTHINK_USERNAME: "u",
    NEXTHINK_PASSWORD: "p",
  } as NodeJS.ProcessEnv);
  assert.equal(cfg.auth.type, "basic");
});

test("oauth2_post is honored and uses default scope", () => {
  const cfg = loadConfig({
    ...base,
    NEXTHINK_AUTH_TYPE: "oauth2_post",
  } as NodeJS.ProcessEnv);
  assert.equal(cfg.auth.type, "oauth2_post");
});

test("unknown auth type is rejected", () => {
  assert.throws(
    () =>
      loadConfig({ ...base, NEXTHINK_AUTH_TYPE: "kerberos" } as NodeJS.ProcessEnv),
    ConfigError
  );
});

test("read-only flag and allow-list parse correctly", () => {
  const cfg = loadConfig({
    ...base,
    NEXTHINK_READ_ONLY: "true",
    NEXTHINK_ALLOWED_ACTIONS: "act:a, act:b ,",
  } as NodeJS.ProcessEnv);
  assert.equal(cfg.readOnly, true);
  assert.deepEqual(cfg.allowedActions, ["act:a", "act:b"]);
});
