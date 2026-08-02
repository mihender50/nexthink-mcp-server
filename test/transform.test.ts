import { test } from "node:test";
import assert from "node:assert/strict";
import { transformNexthinkTabularResponse } from "../src/transform.js";

test("transforms tabular headers+rows into keyed records", () => {
  const raw = {
    executionTime: 42,
    data: {
      headers: [
        { name: "device.name", type: "string" },
        { name: "device.hardware.memory", type: "integer" },
        { name: "device.operating_system.name", type: "string" },
      ],
      rows: [
        ["HOST-NY-01", 16384, "Windows 11 Pro"],
        ["HOST-LON-02", 32768, "Windows 11 Enterprise"],
      ],
    },
  };

  const out = transformNexthinkTabularResponse(raw);

  assert.equal(out.total_rows, 2);
  assert.equal(out.execution_time_ms, 42);
  assert.deepEqual(out.results[0], {
    "device.name": "HOST-NY-01",
    "device.hardware.memory": 16384,
    "device.operating_system.name": "Windows 11 Pro",
  });
  assert.deepEqual(out.results[1], {
    "device.name": "HOST-LON-02",
    "device.hardware.memory": 32768,
    "device.operating_system.name": "Windows 11 Enterprise",
  });
});

test("handles empty result sets", () => {
  const out = transformNexthinkTabularResponse({
    executionTime: 5,
    data: { headers: [{ name: "device.name" }], rows: [] },
  });
  assert.equal(out.total_rows, 0);
  assert.equal(out.execution_time_ms, 5);
  assert.deepEqual(out.results, []);
});

test("is defensive against missing/undefined payloads", () => {
  const out = transformNexthinkTabularResponse(undefined);
  assert.deepEqual(out, { total_rows: 0, execution_time_ms: 0, results: [] });
});

test("pads short rows with null for absent columns", () => {
  const out = transformNexthinkTabularResponse({
    data: {
      headers: [{ name: "a" }, { name: "b" }, { name: "c" }],
      rows: [["x"]],
    },
  });
  assert.deepEqual(out.results[0], { a: "x", b: null, c: null });
});
