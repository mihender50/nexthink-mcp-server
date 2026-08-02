/**
 * Pure transformation helpers for Nexthink NQL responses.
 *
 * Nexthink's `/api/v2/nql/execute` endpoint returns tabular matrix data
 * (a `headers` array plus a `rows` matrix) to minimize bandwidth. LLMs work
 * far more reliably with key-value objects than positional arrays, so we
 * flatten the matrix into an array of records keyed by column name.
 */

export interface NqlHeader {
  name: string;
  type?: string;
}

export interface RawNqlResponse {
  executionTime?: number;
  data?: {
    headers?: NqlHeader[];
    rows?: unknown[][];
  };
}

export interface NormalizedNqlResponse {
  total_rows: number;
  execution_time_ms: number;
  results: Array<Record<string, unknown>>;
}

/**
 * Transforms a raw tabular Nexthink NQL response into an LLM-friendly shape.
 *
 * Defensive against partial/malformed payloads: missing blocks yield empty
 * results rather than throwing, and short rows produce `null` for absent
 * columns so downstream consumers never hit index errors.
 */
export function transformNexthinkTabularResponse(
  raw: RawNqlResponse | null | undefined
): NormalizedNqlResponse {
  const executionTime = raw?.executionTime ?? 0;
  const dataBlock = raw?.data ?? {};
  const headers = (dataBlock.headers ?? []).map((h) => h.name);
  const rows = dataBlock.rows ?? [];

  const results: Array<Record<string, unknown>> = rows.map((row) => {
    const record: Record<string, unknown> = {};
    headers.forEach((header, idx) => {
      record[header] = idx < row.length ? row[idx] : null;
    });
    return record;
  });

  return {
    total_rows: results.length,
    execution_time_ms: executionTime,
    results,
  };
}
