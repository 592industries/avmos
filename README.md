# AVMOS

**Autonomous Verification, Monitoring & Operations System**

AVMOS observes infrastructure, asks Grok to propose a response, applies deterministic policy, and records the result in DeepSpace. The model never authorizes, signs, or submits a financial transaction.

## Problem and architecture

Repeated infrastructure alerts can prompt duplicate or unsafe remediation payments. AVMOS uses New Relic as evidence, a policy engine as authority, a serialized DeepSpace Durable Object reservation as a budget and remediation guard, and a protected XRPL Testnet executor as the only signer.

```text
New Relic StorageSample → server poll → shared DeepSpace resource + historical trend → optional Tavily research → Grok proposal
  → validated intent → deterministic policy → atomic budget reservation
  → XRPL Testnet executor (or explicit simulation) → verification → DeepSpace audit
```

The DeepSpace Worker provides authenticated actions, role checks, RecordRoom state, realtime subscriptions, CronRoom scheduling, and deployment. `/` is the public product site, `/dashboard` is the authenticated operations console, and `/home` redirects to `/`. A minute CronRoom task pulls New Relic data once per app through a short Durable Object lease and stores normalized current and historical records for `avmos`. Browser tabs receive those records through DeepSpace realtime. Hourly tasks aggregate telemetry and prune expired records in bounded batches. Autonomous operation runs are separate and remain disabled by default.

## Security and execution

- Live runs require a New Relic user key, account, entity GUID, and a Grok key. Missing or stale evidence cannot authorize live spending. The `avmos` resource is the default target. The 75% warning, 80% action, and 90% critical thresholds apply to verified storage utilization. Demo fixtures are used only when `DEMO_MODE=true` and a demo action is explicitly selected.
- Actions require verified bearer JWTs and application roles. Financial actions require the app owner and a UUID `Idempotency-Key`. The operator assistant has read-only tools.
- An operation reservation serializes budget checks and blocks repeat remediation on the same resource, action, and vendor. Successful operations retain a 24-hour cooldown. An unknown XRPL outcome keeps its reservation until reconciliation.
- The executor accepts an approved payment request, checks the configured vendor destination, and connects only to `wss://s.altnet.rippletest.net:51233`. It verifies the ledger result separately. `XRPL_EXECUTION_MODE=simulated` is the safe default.
- DeepSpace stores current telemetry separately from seven-day raw observations and thirty-day hourly aggregates. Actions, policy decisions, operational logs, alerts, and audit records have explicit configurable retention periods.
- DeepSpace audit events and action records record the policy decision and settlement state. A ledger outcome and audit persistence have separate statuses; audit failure must never trigger an automatic payment retry.

## Local development

Use Node 24 and npm 11.6 or newer. Install with `npm ci`, authenticate with `npx deepspace auth login`, then run `npm run dev`. The immutable `DEEPSPACE_APP_ID` already exists in `wrangler.toml`; do not replace it. The GitHub `origin` remote is the source repository; this project does not use `deepspace push`.

Configure the names in [`.env.example`](./.env.example) through `npx deepspace secrets set KEY=value`. DeepSpace owns platform identity, JWT, owner, and app bindings. Never commit wallet seeds, user keys, JWTs, or `.dev.vars`.

For a live operation, configure New Relic and Grok, ensure exactly one enabled authorization policy exists (or set `ACTIVE_POLICY_ID` to select an enabled policy), and set a valid Testnet vendor destination. Settle in simulated mode first. Enable XRPL live mode only after checking the account, RLUSD issuer and trust line, destination, policy, and reconciliation process. `AUTONOMOUS_RUNS_ENABLED=false`, `DEMO_MODE=false`, and `ALLOW_DEBUG_ROUTES=false` are the production defaults.

## Verification and demo

Run `npm run lint`, `npm run type-check`, `npm run test:unit`, `npm test`, and `npm run build`. `npm test` uses the DeepSpace test runner and needs a valid DeepSpace session. CI runs validation before deploying pushes to `main`.

The approved path observes live New Relic storage telemetry, computes a historical trend, validates Grok's proposal, reserves budget, and simulates or submits settlement. The demo approved control proposes 129 RLUSD; the demo rejection control proposes 700 RLUSD against the 250 RLUSD transaction limit and requires `DEMO_MODE=true`. Denial is audited as `POLICY_DENIED` before any executor call. The audit timeline reflects records as they arrive through DeepSpace realtime.

## Limits

The exact `StorageSample` attribute set and entity mapping must be checked against the connected New Relic account. No live integration has been verified without operator credentials. Reconciliation of an `UNKNOWN` XRPL submission is manual; automatic retry is intentionally disabled. The current UI displays the `avmos` infrastructure entity. See [architecture](./docs/architecture.md) and [threat model](./docs/threat-model.md).
