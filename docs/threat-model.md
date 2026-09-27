# AVMOS threat model

| Threat | Boundary | Mitigation and test |
| --- | --- | --- |
| Prompt injection in telemetry or web research | AI | Evidence stays in the user payload; the model has no execution tool. Malformed intent tests must reject. |
| Compromised browser or stolen JWT | Worker | Verify JWT signature, issuer, expiry, app role, and owner for financial actions. Test every role and invalid token. |
| Replayed request or duplicate cron cycle | Durable Object | Idempotency key, remediation fingerprint, and cooldown reservation. Test same key, different key, and concurrent runs. |
| Budget race or policy change | Durable Object and policy | Reserve atomically against the selected policy's daily cap; store policy hash with action. Test concurrent reservations and policy updates. |
| Stale or malicious telemetry | Telemetry adapter and policy | Validate value and timestamp, require live source and freshness before spend. Test absent, stale, malformed, and insufficient samples. |
| Wrong network, destination, or asset | XRPL executor | Exact Testnet URL, protected destination mapping, classic address check, RLUSD check, and ledger field verification. Test deceptive URLs and mismatched destinations. |
| Unknown payment state or audit write failure | Executor and audit | Preserve `UNKNOWN` reservation and transaction hash when known; never auto retry. Test submit timeout and audit failure after success. |
| DeepSpace authorization bypass | Worker and RecordRoom | Explicit action allowlist, role checks before elevated tools, authenticated WebSockets, read-only assistant. Test unauthorized actions and subscriptions. |
