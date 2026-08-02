/**
 * Normalizes Nexthink NQL responses into a single LLM-friendly shape,
 * transparently handling both API generations:
 *
 *  - **v2** (`/api/v2/nql/execute`) already returns `data` as an array of
 *    objects keyed by field name — pass through.
 *  - **v1** (`/api/v1/nql/execute`) returns a tabular `headers` array plus a
 *    `rows` matrix of positional values — flatten into keyed objects.
 *
 * Being tolerant of both means the server keeps working if an operator points
 * `NEXTHINK_NQL_EXECUTE_PATH` at either version.
 */

export interface NormalizedNqlResponse {
  total_rows: number;
  results: Array<Record<string, unknown>>;
  query_id?: string;
  executed_query?: string;
  execution_datetime?: string;
}

interface V2Shape {
  queryId?: string;
  executedQuery?: string;
  rows?: number;
  executionDateTime?: string;
  data?: Array<Record<string, unknown>>;
}

interface V1Shape {
  executionTime?: number;
  data?: {
    headers?: Array<{ name: string; type?: string }>;
    rows?: unknown[][];
  };
}

function isV1Tabular(raw: unknown): raw is V1Shape {
  const data = (raw as V1Shape | undefined)?.data;
  return (
    !!data &&
    !Array.isArray(data) &&
    typeof data === "object" &&
    Array.isArray((data as { headers?: unknown }).headers)
  );
}

function flattenV1(raw: V1Shape): NormalizedNqlResponse {
  const headers = (raw.data?.headers ?? []).map((h) => h.name);
  const rows = raw.data?.rows ?? [];
  const results = rows.map((row) => {
    const record: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      record[h] = i < row.length ? row[i] : null;
    });
    return record;
  });
  return { total_rows: results.length, results };
}

/** Transforms any supported NQL response into {@link NormalizedNqlResponse}. */
export function normalizeNqlResponse(
  raw: unknown | null | undefined
): NormalizedNqlResponse {
  if (raw == null || typeof raw !== "object") {
    return { total_rows: 0, results: [] };
  }
  if (isV1Tabular(raw)) {
    return flattenV1(raw as V1Shape);
  }
  // v2: data is already an array of objects.
  const v2 = raw as V2Shape;
  const results = Array.isArray(v2.data) ? v2.data : [];
  return {
    total_rows: typeof v2.rows === "number" ? v2.rows : results.length,
    results,
    query_id: v2.queryId,
    executed_query: v2.executedQuery,
    execution_datetime: v2.executionDateTime,
  };
}
