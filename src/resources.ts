/**
 * MCP resource definitions.
 *
 * Resources let an agent pull static context (the NQL data dictionary and
 * syntax rules) into its window before it drafts a query — dramatically
 * reducing NQL syntax hallucinations.
 */

export const NQL_REFERENCE_URI = "nexthink://schema/nql-reference";

export const NQL_REFERENCE_MARKDOWN = `# Nexthink Query Language (NQL) — Syntax & Domain Reference

## 1. Query Structure
\`\`\`
<namespace> [time_clause] | [filter_clause] | [projection_clause]
\`\`\`
Pipes (\`|\`) chain stages left-to-right.

## 2. Primary Namespaces & Fields
- **devices**: \`device.name\`, \`device.operating_system.name\`, \`device.hardware.memory\`
- **execution**: \`execution.binary.name\`, \`execution.status\`, \`execution.crash.count\`
- **connection**: \`connection.destination.ip\`, \`connection.port\`
- **user**: \`user.name\`, \`user.department\`

## 3. Time Clauses
- Relative: \`during past 24h\`, \`during past 7d\`
- Absolute: \`from 2026-08-01T00:00:00Z to 2026-08-02T00:00:00Z\`

## 4. Operators
- **Filters**: \`where\`, \`include\`, \`exclude\`
- **Projections**: \`list\`, \`summarize\`, \`compute\`
- Aggregations use dotted function calls, e.g. \`execution.crash.count.sum()\`.

## 5. Examples
List device names and OS observed in the last day:
\`\`\`
devices during past 24h
| list device.name, device.operating_system.name
\`\`\`

Total Chrome crashes per device over the last 24h:
\`\`\`
devices during past 24h
| where execution.binary.name == "chrome.exe"
| summarize total_crashes = execution.crash.count.sum() by device.name
\`\`\`

## 6. Notes
- The synchronous execute endpoint caps results at 1000 rows; use the async
  export tool for larger extracts.
- String comparisons are case-sensitive; quote literals with double quotes.
`;

export interface ResourceDefinition {
  uri: string;
  name: string;
  mimeType: string;
  description: string;
  text: string;
}

export const RESOURCES: ResourceDefinition[] = [
  {
    uri: NQL_REFERENCE_URI,
    name: "Nexthink Query Language (NQL) Syntax & Domain Reference",
    mimeType: "text/markdown",
    description:
      "Syntax rules, time clauses, aggregations, and core object domains for authoring valid NQL queries.",
    text: NQL_REFERENCE_MARKDOWN,
  },
];
