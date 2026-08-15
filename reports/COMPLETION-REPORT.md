# Platform Completion Report — nexthink-mcp-server

**Version** 3.0.0 · **Commit** `da34c94` · **Branch** `main`

A rendered version of this report, with charts, is at
[`completion-report.html`](./completion-report.html) (open it in a browser —
it is self-contained).

Every figure below marked *measured* was produced by running the repository's
own tooling during the audit, not estimated. Reproduce with:

```bash
npm ci
npm run typecheck
npm test
npx tsx --test --experimental-test-coverage test/*.test.ts
```

---

## Headline: ~81% complete

The product surface is essentially finished. What remains is **proof and
optional protocol reach**, not features.

| Area | Weight | Complete | Contributes |
| --- | ---: | ---: | ---: |
| Core runtime & tool surface | 40 | 97% | 38.8 pts |
| Testing & verification | 20 | 74% | 14.8 pts |
| Docs & developer experience | 10 | 93% | 9.3 pts |
| CI/CD, security & release | 10 | 85% | 8.5 pts |
| MCP protocol surface | 12 | 45% | 5.4 pts |
| Transport & deployment | 8 | 50% | 4.0 pts |
| **Total** | **100** | | **80.8 pts** |

Where the missing ~19 points sit, ranked by what is recoverable:

| Area | Points available |
| --- | ---: |
| MCP protocol surface | 6.6 |
| Testing & verification | 5.2 |
| Transport & deployment | 4.0 |
| CI/CD, security & release | 1.5 |
| Core runtime & tool surface | 1.2 |
| Docs & developer experience | 0.7 |

The weights are an assessment (see [Methodology](#methodology)); the ledger
beneath them is measured.

---

## Feature ledger

**41 capabilities — 31 shipped, 2 partial, 8 not built.**

### Nexthink API surface

| Capability | State | % |
| --- | --- | ---: |
| `execute_nql` | shipped | 100 |
| `export_nql_async` | shipped | 100 |
| `get_nql_export_status` | shipped | 100 |
| `run_remote_action` | shipped | 100 |
| `trigger_workflow` | shipped | 100 |
| `campaigns/trigger` | **dead constant** | 5 |

### Authentication

| Capability | State | % |
| --- | --- | ---: |
| `oauth2_basic` (default) | shipped | 100 |
| `oauth2_post` | shipped | 100 |
| `bearer` | shipped | 100 |
| `basic` | shipped | 100 |
| Token cache + proactive refresh + single-flight | shipped | 100 |
| Provider factory | **untested** | 85 |

### Transport & reliability

| Capability | State | % |
| --- | --- | ---: |
| Full-jitter exponential backoff | shipped | 100 |
| `Retry-After` honoring | shipped | 100 |
| 401 → token refresh → retry (one-shot) | shipped | 100 |
| Non-idempotent replay guard | shipped | 100 |
| Per-request timeout | shipped | 100 |
| stdio transport | shipped | 100 |
| Streamable HTTP transport | **not built** | 0 |

### Data handling

| Capability | State | % |
| --- | --- | ---: |
| NQL v2 object-row passthrough | shipped | 100 |
| NQL v1 tabular zip (headers × matrix) | shipped | 100 |
| Untrusted-payload hardening | shipped | 100 |
| Client-side row cap (`max_rows`) | shipped | 100 |
| Query-id validation before dispatch | shipped | 100 |

### Guardrails

| Capability | State | % |
| --- | --- | ---: |
| Read-only mode | shipped | 100 |
| Remote Action allow-list | shipped | 100 |
| Destructive tool annotations | shipped | 100 |
| Log secret redaction | shipped | 100 |
| Elicitation (server-driven confirm) | **not built** | 0 |

### Configuration

| Capability | State | % |
| --- | --- | ---: |
| Region-partitioned URL derivation | shipped | 100 |
| API base / token URL overrides | shipped | 100 |
| Reliability tuning env vars | shipped | 100 |
| Endpoint path overrides | **1 of 6** | 17 |

### MCP optional capabilities

| Capability | State | % |
| --- | --- | ---: |
| Structured tool output | shipped | 100 |
| Tool annotations | shipped | 100 |
| Resources (static) | shipped | 100 |
| Prompts | not built | 0 |
| Sampling | not built | 0 |
| Completions | not built | 0 |
| Resource templates / subscriptions | not built | 0 |
| Logging notifications | not built | 0 |

> **Not all gaps are oversights.** `docs/CAPABILITIES.md` names prompts,
> sampling, elicitation, completions, resource templates and Streamable HTTP as
> deliberate omissions. They still count against completeness — a documented gap
> is a gap — but they are known, not discovered. The genuinely unintentional
> finding is `campaignTrigger`.

---

## Testing

**82 tests pass, 0 fail.** 1,259 test lines against 1,732 source lines
(0.73:1). Typecheck is clean under `strict`.

### Line coverage by module — *measured*

| Module | Coverage |
| --- | ---: |
| `src/nexthink/client.ts` | 100.00% |
| `src/transform.ts` | 100.00% |
| `src/resources.ts` | 100.00% |
| `src/auth/staticProviders.ts` | 100.00% |
| `src/logger.ts` | 98.51% |
| `src/server.ts` | 95.08% |
| `src/errors.ts` | 93.48% |
| `src/http/client.ts` | 92.44% |
| `src/config.ts` | 90.20% |
| `src/auth/oauthProvider.ts` | 88.24% |
| `src/auth/factory.ts` | **0%** |
| `src/index.ts` | **0%** |

Aggregate across the ten instrumented files: **95.57% line / 89.60% branch**.

`factory.ts` and `index.ts` do not appear in the coverage report at all — no
unit test imports either. Both execute inside `test/smoke.mjs` as a subprocess,
which exercises only the `bearer` branch and contributes no coverage.

### Testing types

**Present (9):**

| Type | What it covers |
| --- | --- |
| Unit | transform, config, logger, errors |
| Contract | exact wire JSON pinned against published Nexthink API models |
| Integration | real `McpServer` driven over `InMemoryTransport` |
| Adversarial input | 17 malformed response bodies × 5 tools |
| Socket-level | real `node:http` servers for retry, 429, and token flows |
| Smoke / local E2E | stdio subprocess, full MCP handshake, both modes |
| Static typing | `tsc --strict`, no implicit any |
| Secret scanning | trufflehog + `detect-private-key` via pre-commit |
| Dependency automation | Dependabot |

**Absent (7):**

| Type | Consequence |
| --- | --- |
| Live-tenant E2E | no call has ever been made to a real Nexthink instance |
| Coverage gate | coverage never runs in CI; test-depth regressions land silently |
| Lint / format | no ESLint or Prettier config exists |
| Load & rate-limit | 429 behaviour unproven at volume |
| Mutation testing | assertion strength unmeasured |
| Fuzzing | query ids and parameters are stringly-typed |
| Soak / concurrency | single-flight proven at n=3 only |

The suite is unusually strong for its size — the contract tests exist precisely
because 3.0.0 had to correct a request shape the API never accepted, and the
hostile-input matrix guards a real failure mode (output-schema validation runs
*after* the handler returns, so a malformed upstream response can fail a call
whose side effect already happened). Its blind spot is everything requiring a
real network peer.

---

## What is left to complete

Twelve items, tiered by what each unblocks.

### P1 — blocks production confidence

| Item | Effort | Points |
| --- | --- | ---: |
| **Validate every endpoint against a live tenant.** Run the read path first with `NEXTHINK_READ_ONLY=true`, capture real error bodies and rate-limit behaviour, then pin them as fixtures. | M | ~3.0 |
| **Unit-cover `src/auth/factory.ts` and `src/index.ts`.** The factory's oauth and basic branches have never executed in a test. | S | ~1.2 |

### P2 — hardening

| Item | Effort | Points |
| --- | --- | ---: |
| **Run coverage in CI with a threshold.** Available locally, but no workflow step invokes it. | S | ~1.0 |
| **Add ESLint + Prettier.** Style is currently held by convention alone; pre-commit covers hygiene and secrets, not code. | S | ~0.7 |
| **Merge [PR #12](https://github.com/mihender50/nexthink-mcp-server/pull/12)** to clear the moderate `hono` advisory reaching the tree via `@modelcontextprotocol/sdk` → `@hono/node-server`. Not directly exploitable (stdio only). Dependabot already has the bump open — this is a merge, not a fix. | XS | ~0.5 |
| **Resolve the dead `campaignTrigger` constant.** Either wire a campaigns tool or delete it. | XS | ~0.3 |

### P3 — capability growth

| Item | Effort | Points |
| --- | --- | ---: |
| **Streamable HTTP transport.** Named in the docs as the highest-value addition; unlocks remote hosting and multiple concurrent clients. | L | ~4.0 |
| **Elicitation for destructive tools.** Today the safety story is annotations plus an allow-list, and depends on the client honouring them. | M | ~2.2 |
| **Prompts and resource templates.** A saved-query catalog is exactly what resource templates model, and would soften the biggest usability constraint: agents cannot discover query ids. | M | ~2.0 |
| **MCP logging notifications.** Diagnostics reach stderr only, which an MCP client cannot see. | S | ~1.4 |
| **Load and rate-limit testing.** Backoff maths is unit-tested; sustained-429 behaviour is not. | M | ~1.2 |
| **Make the remaining five endpoint paths overridable.** Only `nqlExecute` reads an env override; a gateway that remaps the others cannot be configured. | XS | ~0.7 |

---

## Findings worth acting on independently

Three things surfaced during the audit that stand on their own, regardless of
what you make of the percentages:

1. **Nothing has been proven against a live Nexthink tenant.** Every contract is
   verified against stubs and published models. `docs/RESEARCH.md` concedes that
   error-body shapes, rate limits and partial-result semantics are unconfirmed.
   This matters more than usual here: 3.0.0 exists *because* every prior release
   posted `{query: "<NQL text>"}`, a shape the API has never accepted, and no
   amount of stub testing caught it. The same class of defect is exactly what a
   live smoke run against one saved query would rule out.

2. **Two source files have zero unit coverage.** `src/auth/factory.ts` and
   `src/index.ts` are absent from the lcov output entirely. The factory is the
   single point where a misconfigured `NEXTHINK_AUTH_TYPE` becomes a concrete
   provider — a cheap, high-value test.

3. **`campaignTrigger` is dead config.** It is declared in `EndpointPaths`,
   defaulted in `DEFAULT_ENDPOINTS`, and threaded through every config fixture
   in the test suite, but no client method or tool ever reads it. Either the
   campaigns API was planned and dropped, or it was copied in speculatively.

---

## Methodology

### Measured — reproducible

| Fact | How |
| --- | --- |
| 82 passing tests, 0 failures | `npm test`, re-run for this audit |
| 95.57% line / 89.60% branch | `node --experimental-test-coverage`, lcov parsed |
| 2 source files at 0% coverage | absent from the lcov report entirely |
| 1,732 src / 1,259 test lines | `wc -l` across both trees |
| 5 tools, 1 resource, 4 auth strategies | read from `registerTool` / `createAuthProvider` |
| `campaignTrigger` unreferenced | grep across `.ts`, `.mjs`, `.md` |
| No ESLint / Prettier config | filesystem check |
| 1 moderate advisory | `npm audit --omit=dev` |
| 0 open issues, 2 open Dependabot PRs | GitHub API (#12 hono, #13 tsx) |

### Assessed — judgment

- **The six area weights** (40/20/12/10/10/8) — how much of a shippable product
  each area represents.
- **Per-area completion percentages** — derived from the feature ledger and the
  coverage data.
- **Per-feature percentages** — binary for most; partials scored against what is
  missing.
- **Tiering and effort sizes** — P1 blocks production, P2 hardens, P3 extends.

Move the weights and the headline moves. Weight testing at 30% instead of 20%
and the total drops to about **78%**; treat the documented MCP omissions as out
of scope rather than incomplete and it rises to about **88%**. The ledger
underneath does not change either way.
