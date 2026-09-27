# AVMOS

**Autonomous Verification, Monitoring & Operations System**

AVMOS observes infrastructure, asks Grok to propose a response, applies deterministic policy, and records the result in DeepSpace. The model never authorizes, signs, or submits a financial transaction.

## Problem and architecture

Repeated infrastructure alerts can prompt duplicate or unsafe remediation payments. AVMOS uses New Relic as evidence, a policy engine as authority, a serialized DeepSpace Durable Object reservation as a budget and remediation guard, and a protected XRPL Testnet executor as the only signer.

```text
New Relic StorageSample → normalized resource + historical trend → Grok proposal
  → validated intent → deterministic policy → atomic budget reservation
  → XRPL Testnet executor (or explicit simulation) → verification → DeepSpace audit
```

The DeepSpace Worker provides authenticated actions, role checks, RecordRoom state, realtime subscriptions, CronRoom scheduling, and deployment. Both manual runs and scheduled runs call the same operation service. Tavily is optional research and has no authorization role.

## Security and execution

- Live runs require a New Relic user key, account, entity GUID, and a Grok key. Missing or stale evidence cannot authorize live spending. Demo fixtures are used only when `DEMO_MODE=true` and a demo action is explicitly selected.
- Actions require verified bearer JWTs and application roles. Financial actions require the app owner and a UUID `Idempotency-Key`. The operator assistant has read-only tools.
- An operation reservation serializes budget checks and blocks repeat remediation on the same resource, action, and vendor. Successful operations retain a 24-hour cooldown. An unknown XRPL outcome keeps its reservation until reconciliation.
- The executor accepts an approved payment request, checks the configured vendor destination, and connects only to `wss://s.altnet.rippletest.net:51233`. It verifies the ledger result separately. `XRPL_EXECUTION_MODE=simulated` is the safe default.
- DeepSpace audit events and action records record the policy decision and settlement state. A ledger outcome and audit persistence have separate statuses; audit failure must never trigger an automatic payment retry.

## Local development

Use Node 24 and npm 11.6 or newer. Install with `npm ci`, authenticate with `npx deepspace auth login`, then run `npm run dev`. The immutable `DEEPSPACE_APP_ID` already exists in `wrangler.toml`; do not replace it. The GitHub `origin` remote is the source repository; this project does not use `deepspace push`.

Configure the names in [`.env.example`](./.env.example) through `npx deepspace secrets set KEY=value`. DeepSpace owns platform identity, JWT, owner, and app bindings. Never commit wallet seeds, user keys, JWTs, or `.dev.vars`.

For a live operation, configure New Relic and Grok, ensure exactly one enabled authorization policy exists (or set `ACTIVE_POLICY_ID` to select an enabled policy), and set a valid Testnet vendor destination. Settle in simulated mode first. Enable XRPL live mode only after checking the account, RLUSD issuer and trust line, destination, policy, and reconciliation process. `AUTONOMOUS_RUNS_ENABLED=false`, `DEMO_MODE=false`, and `ALLOW_DEBUG_ROUTES=false` are the production defaults.

## Verification and demo

Run `npm run lint`, `npm run type-check`, `npm run test:unit`, `npm test`, and `npm run build`. `npm test` uses the DeepSpace test runner and needs a valid DeepSpace session. CI runs validation before deploying pushes to `main`.

The approved path observes live New Relic storage telemetry, computes a historical trend, validates Grok's proposal, reserves budget, and simulates or submits settlement. The rejection control is explicitly labeled as a demo and requires `DEMO_MODE=true`; its malicious proposal must be denied before the executor is called. The audit timeline reflects records as they arrive through DeepSpace realtime.

## Limits

The exact `StorageSample` attribute set and entity mapping must be checked against the connected New Relic account. No live integration has been verified without operator credentials. Reconciliation of an `UNKNOWN` XRPL submission is manual; automatic retry is intentionally disabled. The current UI displays one configured infrastructure entity. See [architecture](./docs/architecture.md) and [threat model](./docs/threat-model.md).
