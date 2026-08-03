<!-- Keep this short. Delete sections that don't apply. -->

## What and why

<!-- What changes, and what problem it solves. -->

## API contract

<!--
Only if this touches a Nexthink request or response. Cite the published model
or docs page the shape comes from — this package has shipped bugs from code
written against an assumed contract, so a citation is the review's anchor.
Write "n/a" otherwise.
-->

## Breaking changes

<!--
Any change to a tool's name, input schema, or output schema is breaking for
MCP clients. List them, or write "none".
-->

## Verification

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run test:smoke`
- [ ] New behaviour has a test that fails without the change
- [ ] `CHANGELOG.md` updated for anything user-visible

<!--
If a destructive tool (run_remote_action, trigger_workflow) changed, say how
its guardrails were verified: read-only mode, the allow-list, and the
destructiveHint annotation.
-->
