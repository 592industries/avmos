# AVMOS architecture

## System context and data flow

The public homepage mounts authentication only and cannot subscribe to operational records. Its fleet summary comes from a sanitized HTTP endpoint. Protected console routes authenticate through DeepSpace and read RecordRoom projections over a realtime connection. A leased CronRoom poller is the only production New Relic reader: it queries account-level SystemSample, StorageSample, and NetworkSample data, facets by host, accepts only the configured `avmos-node-` fleet, and normalizes each host into current rows and bounded observations. A host absent from a successful poll becomes `OFFLINE`; stale, missing, and provider-error evidence retain distinct states. Hourly tasks create aggregates and prune expired buckets. Agent cycles read this stored evidence for an explicit resource, then pass a validated proposal through deterministic policy, an atomic budget reservation, and the selected protected provider. Action and audit records preserve the verified outcome.

The Worker owns all policy and integration mutations. The console sends controlled inputs to authenticated HTTP routes; the browser cannot mutate these records directly. Policies are versioned and audited. Integration records contain public settings and verification metadata only. Secrets remain in Worker environment configuration.

## Trust boundaries

**Telemetry:** New Relic is evidence. A missing host, malformed response, stale timestamp, or insufficient trend samples fails the run. The account ID, fleet prefix, and NerdGraph endpoint are server configuration, not browser inputs.

**AI:** Grok and optional Tavily content are untrusted. Grok receives normalized evidence and a computed forecast, and returns a validated proposal. It receives no wallet seed, policy mutation capability, or executor handle.

**Policy and financial execution:** Policy is authority. `ACTIVE_POLICY_ID` is accepted only when that policy applies to the requested resource, action, agent, provider, and vendor. Otherwise exactly one applicable policy is required. Zero or multiple matches deny before provider execution. The selected policy hash is stored on the action. Budget reservation and remediation locking happen in a Durable Object transaction before the executor call. The executor is the only signer and independently checks the XRPL destination, amount, currency, endpoint, and approval metadata.

**DeepSpace:** JWT verification and app role checks occur in the Worker. Effective roles come from canonical workspace membership, with `OWNER_USER_ID` as the explicit owner identity. Authentication provider names, email addresses, and profile fields never grant authorization. RecordRoom is used for live state and audit records. Server-side action tools have elevated record access and must remain limited to reviewed handlers. WebSocket upgrades require a verified token and application role. The SDK currently transports its WebSocket token in the URL; logs should not record query strings.

### Identity acceptance

The account whose DeepSpace user ID matches `OWNER_USER_ID` is the workspace owner and therefore resolves to administrator access. Any other authenticated account receives the role in its canonical workspace membership. This explains the currently observed GitHub account as administrator and Google account as member only when those identities map to the owner and member records respectively; the identity provider itself has no effect on authorization. The administrator-only Settings diagnostics show the provider, provider subject, effective role, and exact role source so this mapping can be verified without exposing tokens.

**XRPL:** The only allowed endpoint is the public XRPL Testnet WebSocket. A result after possible submission can be `UNKNOWN`. The reservation remains held and the operator must query the ledger by hash, compare transaction fields, and mark a reconciled outcome before any new attempt.

## Failure and recovery

New Relic, Grok, policy, or reservation failure prevents payment. A known ledger rejection is `FAILED`; an uncertain submit or verification result is `UNKNOWN` or `RECONCILIATION_REQUIRED`. Audit failure after a confirmed transaction leaves the settlement state intact and marks audit persistence pending. Operators should inspect DeepSpace action state, audit events, and the XRPL ledger; never retry an unknown payment blindly.
