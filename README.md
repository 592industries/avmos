# AVMOS

**Autonomous Verification, Monitoring & Operations System**

AVMOS observes infrastructure, asks Grok to propose a response, applies deterministic policy, and records the result in DeepSpace. The model never authorizes, signs, or submits a financial transaction.

## Problem and architecture

Repeated infrastructure alerts can prompt duplicate or unsafe remediation payments. AVMOS uses New Relic as evidence, a policy engine as authority, a serialized DeepSpace Durable Object reservation as a budget and remediation guard, and a protected XRPL Testnet executor as the only signer. The production fleet consists of New Relic hosts whose names start with `avmos-node-`; unrelated entities are excluded.

```text
New Relic account metrics → server fleet poll → shared DeepSpace current state + bounded history → optional Tavily research → Grok proposal
  → validated intent → deterministic policy → atomic budget reservation
  → XRPL Testnet executor (or explicit simulation) → verification → DeepSpace audit
```

The DeepSpace Worker provides authenticated actions, role checks, RecordRoom state, realtime subscriptions, CronRoom scheduling, and deployment. `/` is the public product site, `/dashboard` is the authenticated operations console, and `/home` redirects to `/`. A minute CronRoom task queries New Relic once per app through a short Durable Object lease, facets results by host, filters the configured fleet prefix, and stores normalized current and historical records. Browser tabs read only DeepSpace state and refresh the console view every 15 seconds while retaining realtime updates. Hourly tasks aggregate telemetry and prune expired records in bounded batches. Autonomous operation runs are separate and remain disabled by default.

## Security and execution

- Live runs require a New Relic user key, account, and Grok key. Missing, stale, offline, or errored evidence cannot authorize live spending. The 75% warning, 80% action, and 90% critical thresholds apply to verified storage utilization.
- Actions require verified bearer JWTs and canonical DeepSpace workspace roles. Policy and integration mutations require an administrator; evaluation requires an administrator and a UUID `Idempotency-Key`. Provider claims and display names never grant roles.
- An operation reservation serializes budget checks and blocks repeat remediation on the same resource, action, and vendor. Successful operations retain a 24-hour cooldown. An unknown XRPL outcome keeps its reservation until reconciliation.
- The executor accepts an approved payment request, checks the configured vendor destination, and connects only to `wss://s.altnet.rippletest.net:51233`. It verifies the ledger result separately. `XRPL_EXECUTION_MODE=simulated` is the safe default.
- DeepSpace stores current telemetry separately from seven-day raw observations and thirty-day hourly aggregates. Actions, policy decisions, operational logs, alerts, and audit records have explicit configurable retention periods.
- DeepSpace audit events and action records record the policy decision and settlement state. A ledger outcome and audit persistence have separate statuses; audit failure must never trigger an automatic payment retry.

## Local development

Use Node 24 and npm 11.6 or newer. Install with `npm ci`, authenticate with `npx deepspace auth login`, then run `npm run dev`. The immutable `DEEPSPACE_APP_ID` already exists in `wrangler.toml`; do not replace it. The GitHub `origin` remote is the source repository; this project does not use `deepspace push`.

Configure the names in [`.env.example`](./.env.example) through `npx deepspace secrets set KEY=value`. DeepSpace owns platform identity, JWT, owner, and app bindings. The integration screen reports and tests configuration but never returns or stores secret values in ordinary records. Never commit wallet seeds, user keys, JWTs, or `.dev.vars`.

For a live operation, configure New Relic and Grok, ensure exactly one enabled policy applies to the requested resource and operation (or set `ACTIVE_POLICY_ID` to select an applicable enabled policy), and set a valid Testnet vendor destination. Settle in simulated mode first. Enable XRPL live mode only after checking the account, RLUSD issuer and trust line, destination, policy, and reconciliation process. `AUTONOMOUS_RUNS_ENABLED=false`, `DEMO_MODE=false`, and `ALLOW_DEBUG_ROUTES=false` are the production defaults.

## Verification

Run `npm run lint`, `npm run type-check`, `npm run test:unit`, `npm test`, and `npm run build`. `npm test` uses the DeepSpace test runner and needs a valid DeepSpace session. CI runs validation before deploying pushes to `main`.

The approved path observes stored New Relic telemetry for the requested resource, computes a historical trend, validates Grok's proposal, resolves exactly one applicable policy, reserves budget, and simulates or submits settlement. A missing policy produces `NO_APPLICABLE_POLICY`; more than one produces `AMBIGUOUS_POLICY`. Both denials are audited before any provider call. The audit timeline reflects records as they arrive through DeepSpace realtime.

## Limits

The exact infrastructure attributes and host facet mapping must be checked against the connected New Relic account. No live integration has been verified without operator credentials. Reconciliation of an `UNKNOWN` XRPL submission is manual; automatic retry is intentionally disabled. See [architecture](./docs/architecture.md) and [threat model](./docs/threat-model.md).
