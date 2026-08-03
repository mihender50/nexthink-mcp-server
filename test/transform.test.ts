import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeNqlResponse } from "../src/transform.js";

test("v2: passes through data array of objects and uses rows count", () => {
  const raw = {
    queryId: "#q_1",
    executedQuery: "devices | list device.name",
    rows: 2,
    executionDateTime: "2026-08-02T00:00:00",
    data: [
      { "device.name": "HOST-NY-01", "device.hardware.memory": 16384 },
      { "device.name": "HOST-LON-02", "device.hardware.memory": 32768 },
    ],
  };
  const out = normalizeNqlResponse(raw);
  assert.equal(out.total_rows, 2);
  assert.equal(out.query_id, "#q_1");
  assert.equal(out.executed_query, "devices | list device.name");
  assert.equal(out.execution_datetime, "2026-08-02T00:00:00");
  assert.deepEqual(out.results[1], {
    "device.name": "HOST-LON-02",
    "device.hardware.memory": 32768,
  });
});

// v1 (NqlApiExecuteResponse) is a FLAT envelope: top-level `headers` of column
// names plus `data` as a positional matrix — not a nested `data.headers`/
// `data.rows` object.
test("v1: zips top-level string headers with the positional data matrix", () => {
  const raw = {
    queryId: "#q_1",
    executedQuery: "devices | list device.name",
    rows: 2,
    executionDateTime: "2026-08-02T00:00:00",
    headers: ["device.name", "device.hardware.memory"],
    data: [
      ["HOST-NY-01", 16384],
      ["HOST-LON-02", 32768],
    ],
  };
  const out = normalizeNqlResponse(raw);
  assert.equal(out.total_rows, 2);
  assert.equal(out.query_id, "#q_1");
  assert.deepEqual(out.results[0], {
    "device.name": "HOST-NY-01",
    "device.hardware.memory": 16384,
  });
  assert.deepEqual(out.results[1], {
    "device.name": "HOST-LON-02",
    "device.hardware.memory": 32768,
  });
});

test("v1: pads short rows with null for absent columns", () => {
  const out = normalizeNqlResponse({
    headers: ["a", "b", "c"],
    data: [["x"]],
  });
  assert.deepEqual(out.results[0], { a: "x", b: null, c: null });
});

test("v1: tolerates header objects from a gateway that echoes column metadata", () => {
  const out = normalizeNqlResponse({
    headers: [{ name: "a", type: "string" }, { name: "b", type: "integer" }],
    data: [["x", 1]],
  });
  assert.deepEqual(out.results[0], { a: "x", b: 1 });
});

test("total_rows prefers the API's own row count over the array length", () => {
  const out = normalizeNqlResponse({ rows: 900, data: [{ a: 1 }] });
  assert.equal(out.total_rows, 900);
  assert.equal(out.results.length, 1);
});

test("is defensive against null/undefined/garbage payloads", () => {
  assert.deepEqual(normalizeNqlResponse(undefined), { total_rows: 0, results: [] });
  assert.deepEqual(normalizeNqlResponse(null), { total_rows: 0, results: [] });
  assert.deepEqual(normalizeNqlResponse(42 as unknown), { total_rows: 0, results: [] });
});

test("v2: empty data yields zero rows", () => {
  const out = normalizeNqlResponse({ rows: 0, data: [] });
  assert.equal(out.total_rows, 0);
  assert.deepEqual(out.results, []);
});

test("v2: drops non-object rows rather than emitting junk records", () => {
  const out = normalizeNqlResponse({ data: [{ a: 1 }, null, "nope"] });
  assert.deepEqual(out.results, [{ a: 1 }]);
});

// ---- untrusted-payload hardening ------------------------------------------
// The result is validated against the tool's outputSchema AFTER the handler
// returns, so a wrong-typed metadata field fails the entire call and discards
// rows that were fetched fine. Metadata must be dropped, never propagated.

test("non-string envelope metadata is dropped, not propagated", () => {
  const out = normalizeNqlResponse({
    queryId: 7,
    executedQuery: null,
    executionDateTime: null,
    rows: 1,
    data: [{ a: 1 }],
  });
  assert.equal(out.query_id, undefined);
  assert.equal(out.executed_query, undefined);
  assert.equal(out.execution_datetime, undefined);
  assert.equal(Object.hasOwn(out, "execution_datetime"), false);
  assert.deepEqual(out.results, [{ a: 1 }]);
});

test("a non-integer or non-finite row count falls back to the array length", () => {
  // JSON.parse('{"rows":1e999}') yields Infinity, which fails z.number().int().
  assert.equal(normalizeNqlResponse({ rows: Infinity, data: [{ a: 1 }] }).total_rows, 1);
  assert.equal(normalizeNqlResponse({ rows: 2.5, data: [{ a: 1 }] }).total_rows, 1);
  assert.equal(normalizeNqlResponse({ rows: -3, data: [{ a: 1 }] }).total_rows, 1);
  assert.equal(normalizeNqlResponse({ rows: "9", data: [{ a: 1 }] }).total_rows, 1);
});

test("headers echoed onto v2 object rows must not be zipped positionally", () => {
  // A gateway that adds column metadata to a v2 payload previously nulled
  // every cell while reporting the correct row count and column names.
  const out = normalizeNqlResponse({
    rows: 2,
    headers: ["device.name", "memory"],
    data: [
      { "device.name": "HOST-1", memory: 16 },
      { "device.name": "HOST-2", memory: 32 },
    ],
  });
  assert.deepEqual(out.results, [
    { "device.name": "HOST-1", memory: 16 },
    { "device.name": "HOST-2", memory: 32 },
  ]);
});

test("a __proto__ column becomes an own property, never a prototype", () => {
  const out = normalizeNqlResponse({
    headers: ["__proto__", "b"],
    data: [[{ polluted: true }, 1]],
  });
  const row = out.results[0] as Record<string, unknown> & { polluted?: unknown };
  assert.equal(Object.getPrototypeOf(row), Object.prototype);
  assert.equal(row.polluted, undefined);
  assert.equal(Object.hasOwn(row, "__proto__"), true);
  assert.deepEqual(row.__proto__, { polluted: true });
  assert.equal(({} as { polluted?: unknown }).polluted, undefined);
});

test("duplicate column names are suffixed instead of overwriting", () => {
  const out = normalizeNqlResponse({ headers: ["a", "a"], rows: 1, data: [["L", "R"]] });
  assert.deepEqual(out.results[0], { a: "L", a_2: "R" });
});

test("blank column names become positional keys instead of being dropped", () => {
  const out = normalizeNqlResponse({ headers: ["", "b"], data: [["kept-too", "kept"]] });
  assert.deepEqual(out.results[0], { column_0: "kept-too", b: "kept" });
});

test("v1 with zero columns still yields one record per row", () => {
  const out = normalizeNqlResponse({ headers: [], data: [["x", "y"]] });
  assert.equal(out.total_rows, 1);
  assert.deepEqual(out.results, [{}]);
});
