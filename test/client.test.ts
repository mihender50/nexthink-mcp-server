/**
 * Contract tests for the domain client.
 *
 * These pin the exact JSON the server puts on the wire against the published
 * Nexthink API models. The bug they exist to prevent: the client used to POST
 * `{query: "<NQL text>"}` to the NQL endpoints, which the API never accepted —
 * it takes `{queryId, parameters}` referencing a query saved in the web UI.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NexthinkClient, normalizeQueryId } from "../src/nexthink/client.js";
import type { NexthinkHttp, RequestOptions } from "../src/http/client.js";
import { DEFAULT_ENDPOINTS, type NexthinkConfig } from "../src/config.js";
import { Logger } from "../src/logger.js";
import { NexthinkApiError } from "../src/errors.js";

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

/** Captures the outgoing request and replays a canned response. */
function stubHttp(response: unknown) {
  const calls: RequestOptions[] = [];
  const http = {
    request: async (opts: RequestOptions) => {
      calls.push(opts);
      return response;
    },
  } as unknown as NexthinkHttp;
  return { http, calls };
}

// ---- queryId normalization ------------------------------------------------

test("normalizeQueryId adds the leading # and accepts valid ids", () => {
  assert.equal(normalizeQueryId("my_query"), "#my_query");
  assert.equal(normalizeQueryId("#my_query"), "#my_query");
  assert.equal(normalizeQueryId("  #my_query  "), "#my_query");
  assert.equal(normalizeQueryId("q1_a2"), "#q1_a2");
});

test("normalizeQueryId rejects NQL text with an actionable message", () => {
  assert.throws(
    () => normalizeQueryId("devices | list device.name"),
    (err: unknown) => {
      assert.ok(err instanceof NexthinkApiError);
      assert.equal(err.status, 400);
      assert.match(err.message, /cannot execute ad-hoc NQL/);
      return true;
    }
  );
});

test("normalizeQueryId rejects uppercase, hyphens, and too-short ids", () => {
  for (const bad of ["MyQuery", "my-query", "a", "#a", "my query"]) {
    assert.throws(() => normalizeQueryId(bad), NexthinkApiError, `expected reject: ${bad}`);
  }
});

// ---- NQL execute ----------------------------------------------------------

test("executeNql posts {queryId, parameters} — never NQL text", async () => {
  const { http, calls } = stubHttp({ queryId: "#q_devices", rows: 1, data: [{ a: 1 }] });
  const client = new NexthinkClient(config(), http, logger);

  await client.executeNql("q_devices", { region: "EMEA" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].path, "/api/v2/nql/execute");
  assert.deepEqual(calls[0].body, {
    queryId: "#q_devices",
    parameters: { region: "EMEA" },
  });
  assert.equal(
    Object.hasOwn(calls[0].body as object, "query"),
    false,
    "must not send a `query` field"
  );
});

test("executeNql omits parameters entirely when none are supplied", async () => {
  const { http, calls } = stubHttp({ rows: 0, data: [] });
  const client = new NexthinkClient(config(), http, logger);

  await client.executeNql("#q_devices");
  assert.deepEqual(calls[0].body, { queryId: "#q_devices" });

  await client.executeNql("#q_devices", {});
  assert.deepEqual(calls[1].body, { queryId: "#q_devices" });
});

test("executeNql strips the in-query $ prefix from parameter keys", async () => {
  const { http, calls } = stubHttp({ rows: 0, data: [] });
  const client = new NexthinkClient(config(), http, logger);

  await client.executeNql("#q_devices", { $device_name: "HOST-01", region: "EMEA" });
  assert.deepEqual((calls[0].body as { parameters: unknown }).parameters, {
    device_name: "HOST-01",
    region: "EMEA",
  });
});

test("executeNql rejects parameter keys that collide after $-stripping", async () => {
  const { http, calls } = stubHttp({ rows: 0, data: [] });
  const client = new NexthinkClient(config(), http, logger);

  // Order-dependent last-wins would silently run a different query.
  for (const params of [
    { $region: "EMEA", region: "AMER" },
    { region: "AMER", $region: "EMEA" },
  ]) {
    await assert.rejects(
      () => client.executeNql("#q_devices", params),
      (err: NexthinkApiError) =>
        err.status === 400 && /supplied more than once/.test(err.message)
    );
  }
  assert.equal(calls.length, 0, "must not reach the network");
});

test("executeNql rejects a parameter key that is empty after $-stripping", async () => {
  const { http } = stubHttp({ rows: 0, data: [] });
  const client = new NexthinkClient(config(), http, logger);

  await assert.rejects(
    () => client.executeNql("#q_devices", { $: "bare" }),
    (err: NexthinkApiError) => err.status === 400 && /is empty/.test(err.message)
  );
});

test("executeNql truncates client-side and flags it, preserving the API row count", async () => {
  const data = [{ a: 1 }, { a: 2 }, { a: 3 }];
  const { http } = stubHttp({ rows: 3, data });
  const client = new NexthinkClient(config(), http, logger);

  const out = await client.executeNql("#q_devices", undefined, 2);
  assert.equal(out.results.length, 2);
  assert.equal(out.truncated, true);
  assert.equal(out.total_rows, 3);

  const untouched = await client.executeNql("#q_devices", undefined, 10);
  assert.equal(untouched.results.length, 3);
  assert.equal(untouched.truncated, undefined);
});

// ---- NQL export + status --------------------------------------------------

test("exportNqlAsync posts {queryId, parameters, compression} and reads exportId", async () => {
  const { http, calls } = stubHttp({ exportId: "exp-123" });
  const client = new NexthinkClient(config(), http, logger);

  const out = await client.exportNqlAsync("q_big", { region: "EMEA" }, "ZSTD");

  assert.equal(calls[0].path, "/api/v1/nql/export");
  assert.deepEqual(calls[0].body, {
    queryId: "#q_big",
    parameters: { region: "EMEA" },
    compression: "ZSTD",
  });
  assert.equal(out.export_id, "exp-123");
});

test("exportNqlAsync omits compression when not requested", async () => {
  const { http, calls } = stubHttp({ exportId: "exp-1" });
  const client = new NexthinkClient(config(), http, logger);

  await client.exportNqlAsync("#q_big");
  assert.deepEqual(calls[0].body, { queryId: "#q_big" });
});

test("getExportStatus maps the documented status envelope", async () => {
  const { http, calls } = stubHttp({
    status: "COMPLETED",
    resultsFileUrl: "https://s3.example/exp-123.csv",
  });
  const client = new NexthinkClient(config(), http, logger);

  const out = await client.getExportStatus("exp 123");
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].path, "/api/v1/nql/status/exp%20123");
  assert.equal(out.status, "COMPLETED");
  assert.equal(out.results_file_url, "https://s3.example/exp-123.csv");
  assert.equal(out.error_description, undefined);
});

test("getExportStatus surfaces errorDescription on a failed export", async () => {
  const { http } = stubHttp({ status: "ERROR", errorDescription: "query timed out" });
  const client = new NexthinkClient(config(), http, logger);

  const out = await client.getExportStatus("exp-1");
  assert.equal(out.status, "ERROR");
  assert.equal(out.error_description, "query timed out");
  assert.equal(out.results_file_url, undefined);
});

// ---- Remote actions -------------------------------------------------------

test("runRemoteAction reads requestId from the ExecutionResponse", async () => {
  const { http, calls } = stubHttp({ requestId: "req-7", expiresInMinutes: 60 });
  const client = new NexthinkClient(config(), http, logger);

  const out = await client.runRemoteAction({
    remoteActionId: "act-1",
    devices: ["dev-a", "dev-b"],
    expiresInMinutes: 60,
  });

  assert.equal(calls[0].path, "/api/v1/act/execute");
  assert.deepEqual(calls[0].body, {
    remoteActionId: "act-1",
    devices: ["dev-a", "dev-b"],
    params: {},
    expiresInMinutes: 60,
  });
  assert.equal(out.request_id, "req-7");
  assert.equal(out.target_count, 2);
  assert.equal(out.expires_in_minutes, 60);
});

test("runRemoteAction enforces the allow-list before any HTTP call", async () => {
  const { http, calls } = stubHttp({ requestId: "req-7" });
  const client = new NexthinkClient(config({ allowedActions: ["act-ok"] }), http, logger);

  await assert.rejects(
    () => client.runRemoteAction({ remoteActionId: "act-nope", devices: ["d"] }),
    (err: NexthinkApiError) => err.status === 403
  );
  assert.equal(calls.length, 0, "must not reach the network");
});

// ---- Workflows ------------------------------------------------------------

test("triggerWorkflow always sends both target arrays and reads the uuid envelope", async () => {
  const { http, calls } = stubHttp({
    requestUuid: "req-uuid",
    executionsUuids: ["exec-1", "exec-2"],
  });
  const client = new NexthinkClient(config(), http, logger);

  const out = await client.triggerWorkflow({
    workflowId: "wf-1",
    devices: ["dev-a"],
    params: { reason: "patch" },
  });

  assert.equal(calls[0].path, "/api/v1/workflows/execute");
  assert.deepEqual(calls[0].body, {
    workflowId: "wf-1",
    devices: ["dev-a"],
    users: [],
    params: { reason: "patch" },
  });
  assert.equal(out.request_uuid, "req-uuid");
  assert.deepEqual(out.execution_uuids, ["exec-1", "exec-2"]);
  assert.equal(out.target_count, 1);
});

test("triggerWorkflow counts device and user targets together", async () => {
  const { http } = stubHttp({ requestUuid: "r", executionsUuids: ["e"] });
  const client = new NexthinkClient(config(), http, logger);

  const out = await client.triggerWorkflow({
    workflowId: "wf-1",
    devices: ["dev-a", "dev-b"],
    users: ["S-1-5-21-1"],
  });
  assert.equal(out.target_count, 3);
});

test("response mappers never emit [object Object] for a malformed payload", async () => {
  const { http } = stubHttp({
    exportId: { id: "nested" },
    status: ["COMPLETED"],
    resultsFileUrl: { url: "u" },
    requestId: 42,
    requestUuid: 42,
    executionsUuids: [null, { a: 1 }, 7, "exec-real"],
  });
  const client = new NexthinkClient(config(), http, logger);

  // Export is read-only and nothing has happened yet, so an unusable handle is
  // an error rather than a success the caller cannot poll.
  await assert.rejects(
    () => client.exportNqlAsync("#q_devices"),
    (err: NexthinkApiError) => /no exportId/.test(err.message)
  );
  const status = await client.getExportStatus("e");
  assert.equal(status.status, "");
  assert.equal(status.results_file_url, "");
  assert.equal(
    (await client.runRemoteAction({ remoteActionId: "a", devices: ["d"] })).request_id,
    "42"
  );
  // Junk uuids are dropped rather than surfaced as empty-string ids.
  const wf = await client.triggerWorkflow({ workflowId: "w", devices: ["d"] });
  assert.deepEqual(wf.execution_uuids, ["7", "exec-real"]);
});

test("destructive mappers degrade rather than throw, so the caller learns it fired", async () => {
  // Deliberate asymmetry with export: by the time these responses are parsed
  // the action has already run on real endpoints. Throwing would hide that and
  // invite the model to retry, so an empty handle plus `raw` is returned.
  const { http } = stubHttp({});
  const client = new NexthinkClient(config(), http, logger);

  const ra = await client.runRemoteAction({ remoteActionId: "a", devices: ["d"] });
  assert.equal(ra.request_id, "");
  assert.equal(ra.target_count, 1);

  const wf = await client.triggerWorkflow({ workflowId: "w", devices: ["d"] });
  assert.equal(wf.request_uuid, "");
  assert.deepEqual(wf.execution_uuids, []);

  assert.equal((await client.getExportStatus("e")).status, "");
});

test("an unusable export handle is an error, not a success the caller can't poll", async () => {
  const { http } = stubHttp({});
  const client = new NexthinkClient(config(), http, logger);

  await assert.rejects(
    () => client.exportNqlAsync("#q_devices"),
    (err: NexthinkApiError) =>
      /no handle to poll/.test(err.message) && err.status === undefined
  );
});
