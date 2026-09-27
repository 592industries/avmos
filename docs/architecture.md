# AVMOS architecture

## System context and data flow

The browser authenticates through DeepSpace and reads RecordRoom projections over an authenticated realtime connection. Owner-only action requests enter the Worker with a verified JWT and an idempotency key. CronRoom calls the same `executeAgentCycle` service when autonomous runs are enabled. The service fetches a configured New Relic entity through NerdGraph, normalizes current and historical `StorageSample` data, computes a deterministic trend, and sends only evidence to Grok. A Zod-validated intent passes to deterministic policy. The RecordRoom Durable Object atomically reserves budget and a resource remediation lock. Only then does the protected executor sign a payment or run an explicit simulation. Action and audit records are stored in DeepSpace.

## Trust boundaries

**Telemetry:** New Relic is evidence. A missing host, malformed response, stale timestamp, or insufficient trend samples fails the run. The entity GUID and NerdGraph endpoint are server configuration, not browser inputs.

**AI:** Grok and optional Tavily content are untrusted. Grok receives normalized evidence and a computed forecast, and returns a validated proposal. It receives no wallet seed, policy mutation capability, or executor handle.

**Policy and financial execution:** Policy is authority. Exactly one enabled policy or an explicit enabled policy ID is required for live runs. Its hash is stored on the action. Budget reservation and remediation locking happen in a Durable Object transaction before the executor call. The executor is the only signer and independently checks the XRPL destination, amount, currency, endpoint, and approval metadata.

**DeepSpace:** JWT verification and app role checks occur in the Worker. RecordRoom is used for live state and audit records. Server-side action tools have elevated record access and must remain limited to reviewed action handlers. WebSocket upgrades require a verified token and application role. The SDK currently transports its WebSocket token in the URL; logs should not record query strings.

**XRPL:** The only allowed endpoint is the public XRPL Testnet WebSocket. A result after possible submission can be `UNKNOWN`. The reservation remains held and the operator must query the ledger by hash, compare transaction fields, and mark a reconciled outcome before any new attempt.

## Failure and recovery

New Relic, Grok, policy, or reservation failure prevents payment. A known ledger rejection is `FAILED`; an uncertain submit or verification result is `UNKNOWN`. Audit failure after a confirmed transaction leaves the settlement state intact and marks audit persistence pending. Operators should inspect DeepSpace action state, audit events, and the XRPL ledger; never retry an unknown payment blindly. Demo mode is explicit and cannot use live XRPL settlement.
