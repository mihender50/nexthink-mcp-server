/**
 * MCP resource: the NQL data dictionary and syntax rules.
 *
 * Letting an agent read this before drafting a query sharply reduces NQL
 * syntax hallucinations.
 */

export const NQL_REFERENCE_URI = "nexthink://schema/nql-reference";

export const NQL_REFERENCE_MARKDOWN = `# Nexthink Query Language (NQL) — Syntax & Domain Reference

## 1. Query Structure
\`\`\`
<namespace> [time_clause] | [filter_clause] | [projection_clause] | [limit N]
\`\`\`
Pipes (\`|\`) chain stages left-to-right.

## 2. Primary Namespaces & Fields
- **devices**: \`device.name\`, \`device.operating_system.name\`, \`device.hardware.memory\`, \`device.collector.id\`
- **execution**: \`execution.binary.name\`, \`execution.status\`, \`execution.crash.count\`
- **connection**: \`connection.destination.ip\`, \`connection.port\`
- **user**: \`user.name\`, \`user.department\`

> Remote Actions target devices by **Collector id** (\`device.collector.id\`) —
> query that field to resolve the ids you pass to \`run_remote_action\`.

## 3. Time Clauses
- Relative: \`during past 24h\`, \`during past 7d\`
- Absolute: \`from 2026-08-01T00:00:00Z to 2026-08-02T00:00:00Z\`

## 4. Operators
- **Filters**: \`where\`, \`include\`, \`exclude\`
- **Projections**: \`list\`, \`summarize\`, \`compute\`
- Aggregations use dotted function calls, e.g. \`execution.crash.count.sum()\`.
- **Row limit**: \`| limit 100\` (the synchronous execute endpoint caps at 1000 rows).

## 5. Examples
List Collector ids + names for high-crash Chrome devices:
\`\`\`
devices during past 24h
| where execution.binary.name == "chrome.exe"
| summarize total_crashes = execution.crash.count.sum() by device.name, device.collector.id
| limit 100
\`\`\`

## 6. Notes
- Prefer the v2 execute endpoint; use \`export_nql_async\` for >1000-row extracts.
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
  title: "Nexthink Query Language (NQL) Syntax & Domain Reference",
  mimeType: "text/markdown",
  description:
    "Syntax rules, time clauses, aggregations, and core object domains for authoring valid NQL queries.",
  text: NQL_REFERENCE_MARKDOWN,
};
