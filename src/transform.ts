/**
 * Normalizes Nexthink NQL responses into a single LLM-friendly shape,
 * transparently handling both API generations:
 *
 *  - **v2** (`/api/v2/nql/execute`, `NqlApiExecuteV2Response`) returns `data`
 *    as an array of objects keyed by field name — pass through.
 *  - **v1** (`/api/v1/nql/execute`, `NqlApiExecuteResponse`) returns a
 *    top-level `headers` array of column names plus `data` as a matrix of
 *    positional rows — zip into keyed objects.
 *
 * Both generations also carry `queryId`, `executedQuery`, `rows` and
 * `executionDateTime`. Being tolerant of either means the server keeps working
 * if an operator points `NEXTHINK_NQL_EXECUTE_PATH` at the v1 endpoint (kept
 * only for backward compatibility with pre-v2 integrations).
 *
 * Everything here treats the payload as untrusted. It is parsed JSON from a
 * remote service (possibly via a customer gateway), not a typed value: fields
 * may be absent, null, or the wrong type, and column names are attacker- or
 * operator-controlled strings. Metadata that isn't the declared type is
 * dropped rather than propagated, because the caller validates this object
 * against an output schema *after* the tool handler returns — a stray null
 * there fails the whole call and discards rows that were fetched successfully.
 */

export interface NormalizedNqlResponse {
  total_rows: number;
  results: Array<Record<string, unknown>>;
  query_id?: string;
  executed_query?: string;
  execution_datetime?: string;
}

interface NqlEnvelope {
  queryId?: unknown;
  executedQuery?: unknown;
  rows?: unknown;
  executionDateTime?: unknown;
  headers?: unknown;
  data?: unknown;
}

/**
 * v1 documents `headers` as `string[]`; accept `{name}` objects too so a
 * gateway that echoes column metadata doesn't degrade to unkeyed rows.
 */
function headerName(header: unknown): string {
  if (typeof header === "string") return header;
  const name = (header as { name?: unknown } | null)?.name;
  return typeof name === "string" ? name : "";
}

/**
 * Resolves column names to unique, non-empty record keys. Blank names become
 * positional (`column_0`) and repeats get a numeric suffix, because the
 * alternative — writing several columns to one key — silently discards data
 * while leaving the row count looking correct.
 */
function buildHeaderKeys(headers: unknown[]): string[] {
  const used = new Map<string, number>();
  return headers.map((header, index) => {
    const base = headerName(header) || `column_${index}`;
    const seen = used.get(base);
    used.set(base, (seen ?? 0) + 1);
    return seen === undefined ? base : `${base}_${seen + 1}`;
  });
}

/**
 * v1 is identified by a top-level `headers` array *and* positional row arrays.
 * Checking `headers` alone is not enough: a gateway that echoes column metadata
 * onto a v2 object payload would otherwise be zipped positionally, nulling
 * every cell while reporting the right row count and column names.
 */
function isV1Tabular(raw: NqlEnvelope): raw is NqlEnvelope & { headers: unknown[]; data: unknown[] } {
  if (!Array.isArray(raw.headers) || !Array.isArray(raw.data)) return false;
  return raw.data.length === 0 || raw.data.every((row) => Array.isArray(row));
}

function zipV1(headers: unknown[], rows: unknown[]): Array<Record<string, unknown>> {
  const keys = buildHeaderKeys(headers);
  return rows.map((row) => {
    const cells = Array.isArray(row) ? row : [];
    // Object.fromEntries *defines* properties, so a `__proto__` column becomes
    // an own property instead of invoking the prototype setter.
    return Object.fromEntries(
      keys.map((key, i) => [key, i < cells.length ? cells[i] : null])
    );
  });
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Transforms any supported NQL response into {@link NormalizedNqlResponse}. */
export function normalizeNqlResponse(
  raw: unknown | null | undefined
): NormalizedNqlResponse {
  if (raw == null || typeof raw !== "object") {
    return { total_rows: 0, results: [] };
  }
  const envelope = raw as NqlEnvelope;

  const results = isV1Tabular(envelope)
    ? zipV1(envelope.headers, envelope.data)
    : Array.isArray(envelope.data)
      ? (envelope.data.filter(
          (row) => row != null && typeof row === "object" && !Array.isArray(row)
        ) as Array<Record<string, unknown>>)
      : [];

  // `rows` must survive an output schema of z.number().int(); a non-integer or
  // non-finite value (JSON permits 1e999 -> Infinity) falls back to the count.
  const reported = envelope.rows;
  const normalized: NormalizedNqlResponse = {
    total_rows:
      typeof reported === "number" && Number.isSafeInteger(reported) && reported >= 0
        ? reported
        : results.length,
    results,
  };

  const queryId = asString(envelope.queryId);
  if (queryId !== undefined) normalized.query_id = queryId;
  const executedQuery = asString(envelope.executedQuery);
  if (executedQuery !== undefined) normalized.executed_query = executedQuery;
  const executionDateTime = asString(envelope.executionDateTime);
  if (executionDateTime !== undefined) {
    normalized.execution_datetime = executionDateTime;
  }
  return normalized;
}
