# TypeSafe Jev System One Completion Assessment: `nexthink-mcp-server`

**Evaluated by**: TypeSafe AI Jev System One (`jev-1.13.0`)
**Evaluation Date**: 2026-09-19
**Evaluation Model Contract**: System One probabilistic multi-question evaluation
**Status**: Release Candidate (v3.0.0 Tagged & Tested)

---

## 1. Executive Summary

| Metric | Evaluation Result | Interpretation |
| :--- | :---: | :--- |
| **Holistic Completion Score** | **3.00 / 4.00** | **90% – 93% complete** (100% probability in 85%–95% Release Candidate tier) |
| **Estimated Time to Complete (Agent Cadence)** | **1.36 / 3.00** | **2 to 4 calendar days** (62% probability 3–5d, 5% 1–2d) |
| **Human Equivalent Pacing** | **0.94 / 3.00** | **10 to 20 working days** (2–4 weeks enterprise testing & security certification) |
| **Acceleration Factor** | **~4x** | Rapid agent validation & packaging |

---

## 2. Jev Probabilistic Output

```json
{
  "model": "jev-1.13.0",
  "platform": "nexthink-mcp-server",
  "completion_score": {
    "score": 3.00,
    "confidence": 1.00,
    "probabilities": {
      "0 (Early prototype 0-30%)": 0.0,
      "1 (Mid development 40-65%)": 0.0,
      "2 (Substantially complete 70-85%)": 0.0,
      "3 (Production ready / Release candidate 85-95%)": 1.0,
      "4 (Final GA 95-100%)": 0.0
    }
  },
  "days_agent_cadence": {
    "score": 1.36,
    "confidence": 0.54,
    "probabilities": {
      "0 (1-2 days)": 0.05,
      "1 (3-5 days)": 0.62,
      "2 (6-9 days)": 0.24,
      "3 (10+ days)": 0.09
    }
  },
  "days_human_cadence": {
    "score": 0.94,
    "confidence": 0.78,
    "probabilities": {
      "0 (3-7 days)": 0.14,
      "1 (10-20 days)": 0.80,
      "2 (30-45 days)": 0.05,
      "3 (60+ days)": 0.01
    }
  }
}
```

---

## 3. Ground-Truth Posture

* **Version**: `3.0.0`, targeting Model Context Protocol (MCP) spec 2025-11-25.
* **Unit & Integration Tests**: 82 passed out of 82 total (100% green via Node.js native test runner `tsx --test`).
* **MCP Tools Implemented**:
  * `execute_nql`: Executes saved NQL API queries with strict query id format validation (`^#[a-z0-9_]{2,255}$`).
  * `export_nql_async`: Submits asynchronous large dataset exports and polls handles safely.
  * `run_remote_action`: Governed action execution against allowlisted actions (`NEXTHINK_ALLOWED_ACTIONS`).
* **Hardened Controls**:
  * Read-only mode flag dynamically hides mutating tools.
  * Resilient HTTP client with full-jitter exponential backoff, circuit breaking, and Retry-After parsing.
  * Defensive data transformation protecting against prototype pollution (`__proto__`), duplicate column collisions, and malformed vendor payloads.

---

## 4. Remaining Work to Reach v3.0 / v1.0 Enterprise GA

1. **Live Tenant Verification** (1–2 days):
   * End-to-end sandbox verification against live Nexthink Infinity tenant endpoints.
2. **Enterprise Catalog Publishing** (1 day):
   * Lock release manifest and publish package to corporate MCP catalog.
