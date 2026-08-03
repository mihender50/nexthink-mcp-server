/**
 * MCP resource: how NQL queries are actually reachable over the API, plus the
 * syntax/domain reference an administrator needs to author them.
 *
 * The critical fact for an agent is that the API executes **saved queries by
 * id** — nothing here should imply query text can be submitted at call time.
 */

export const NQL_REFERENCE_URI = "nexthink://schema/nql-reference";

export const NQL_REFERENCE_MARKDOWN = `# Nexthink NQL over the API — How Queries Are Executed

## 0. Read this first: queries run by ID, not by text
The Nexthink public API **cannot execute ad-hoc NQL**. Both
\`POST /api/v2/nql/execute\` and \`POST /api/v1/nql/export\` accept only:

\`\`\`json
{ "queryId": "#my_query_id", "parameters": { "name": "value" } }
\`\`\`

A query must first be authored and saved by an administrator in the Nexthink
web UI under **Administration → Content management → NQL API queries**, which
assigns it an immutable **Query ID**. The API then replays that saved query,
substituting only the parameters it declares.

Consequences for an agent:
- You **cannot** invent a query to answer a novel question. You can only run
  what already exists, so treat the set of saved query ids as a fixed menu.
- Query ids match \`^#[a-z0-9_]{2,255}$\`, e.g. \`#devices_with_high_crashes\`.
- There is **no API endpoint that lists saved queries**. If you do not know the
  id, ask the operator for it — guessing produces an HTTP 400.
- Row limits, time windows, and projections are fixed by the saved query's
  text. \`max_rows\` on \`execute_nql\` only trims rows client-side after the
  fact; it does not narrow the query.

## 1. Parameters
Parameters are the only part of a saved query you can influence.
- They are declared **only in the \`where\` clause**, named with a single
  leading \`$\`, e.g. \`| where device.name == $device_name\`.
- Pass them as string key/value pairs **without** the \`$\`:
  \`{"device_name": "HOST-NY-01"}\`.
- A query that hard-codes a filter cannot be re-pointed by parameters.

## 2. Query Structure (for authoring in the web UI)
\`\`\`
<namespace> [time_clause] | [filter_clause] | [projection_clause] | [limit N]
\`\`\`
Pipes (\`|\`) chain stages left-to-right.

## 3. Primary Namespaces & Fields
- **devices**: \`device.name\`, \`device.operating_system.name\`, \`device.hardware.memory\`, \`device.collector.id\`
- **execution**: \`execution.binary.name\`, \`execution.status\`, \`execution.crash.count\`
- **connection**: \`connection.destination.ip\`, \`connection.port\`
- **user**: \`user.name\`, \`user.department\`

> Remote Actions target devices by **Collector id** (\`device.collector.id\`) —
> query that field to resolve the ids you pass to \`run_remote_action\`.

## 4. Time Clauses
- Relative: \`during past 24h\`, \`during past 7d\`
- Absolute: \`from 2026-08-01T00:00:00Z to 2026-08-02T00:00:00Z\`

## 5. Operators
- **Filters**: \`where\`, \`include\`, \`exclude\`
- **Projections**: \`list\`, \`summarize\`, \`compute\`
- Aggregations use dotted function calls, e.g. \`execution.crash.count.sum()\`.
- **Row limit**: \`| limit 100\` (the synchronous execute endpoint caps at 1000 rows).

## 6. Example of a saved, parameterized query
Authored once in the web UI and saved with Query ID \`#high_crash_devices\`:
\`\`\`
devices during past 24h
| where execution.binary.name == $binary_name
| summarize total_crashes = execution.crash.count.sum() by device.name, device.collector.id
| limit 100
\`\`\`
Invoked through this server as:
\`\`\`
execute_nql(query_id="#high_crash_devices", parameters={"binary_name": "chrome.exe"})
\`\`\`

## 7. Notes
- Prefer the v2 execute endpoint; use \`export_nql_async\` for >1000-row extracts.
  Export uses the same saved-query-by-id contract, plus optional compression.
- String comparisons are case-sensitive; quote literals with double quotes.
`;

export interface ResourceDefinition {
  uri: string;
  name: string;
  title: string;
  mimeType: string;
  description: string;
  text: string;
}

export const NQL_REFERENCE: ResourceDefinition = {
  uri: NQL_REFERENCE_URI,
  name: "nql-reference",
  title: "Nexthink NQL API Reference — Saved Queries, Parameters & Syntax",
  mimeType: "text/markdown",
  description:
    "How the NQL API executes saved queries by id (ad-hoc NQL text is not supported), how " +
    "parameters bind, plus syntax rules, time clauses, aggregations, and core object domains.",
  text: NQL_REFERENCE_MARKDOWN,
};
