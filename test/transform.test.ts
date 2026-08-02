import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeNqlResponse } from "../src/transform.js";

test("v2: passes through data array of objects and uses rows count", () => {
  const raw = {
    queryId: "q-1",
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
  assert.equal(out.query_id, "q-1");
  assert.equal(out.executed_query, "devices | list device.name");
  assert.equal(out.execution_datetime, "2026-08-02T00:00:00");
  assert.deepEqual(out.results[1], {
    "device.name": "HOST-LON-02",
    "device.hardware.memory": 32768,
  });
});

test("v1: flattens tabular headers+rows into keyed records", () => {
  const raw = {
    executionTime: 42,
    data: {
      headers: [
        { name: "device.name", type: "string" },
        { name: "device.hardware.memory", type: "integer" },
      ],
      rows: [
        ["HOST-NY-01", 16384],
        ["HOST-LON-02", 32768],
      ],
    },
  };
  const out = normalizeNqlResponse(raw);
  assert.equal(out.total_rows, 2);
  assert.deepEqual(out.results[0], {
    "device.name": "HOST-NY-01",
    "device.hardware.memory": 16384,
  });
});

test("v1: pads short rows with null for absent columns", () => {
  const out = normalizeNqlResponse({
    data: { headers: [{ name: "a" }, { name: "b" }, { name: "c" }], rows: [["x"]] },
  });
  assert.deepEqual(out.results[0], { a: "x", b: null, c: null });
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
