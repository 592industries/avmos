# Agent-Monitor

Agent-Monitor is a DeepSpace-native infrastructure operations prototype. It turns normalized infrastructure telemetry into a schema-validated economic action, evaluates that action with deterministic policy code, and sends approved payments through a protected XRPL Testnet executor.

The core invariant is enforced by module boundaries:

```text
LibreNMS + Timescale bridge
          ↓
      AgentRuntime ── Grok / demo model
          ↓
    validated ActionIntent
          ↓
 deterministic policy engine
      ↙ DENIED    ↘ APPROVED
  audit only       ApprovedPaymentRequest
                          ↓
                 protected XRPL executor
                          ↓
                  DeepSpace audit state
```

The model never receives the wallet seed, policy configuration, or signing function. `OperationsOrchestrator` is the only component that converts an approved decision into `ApprovedPaymentRequest`; denied decisions return before the executor call.

## DeepSpace responsibilities

- RecordRoom collections store agents, resources, policies, actions, and audit events.
- Server actions run owner-gated operational cycles and answer Photon-style questions.
- Record subscriptions update the dashboard in realtime.
- CronRoom can run the observation cycle every 15 minutes, but only when `AUTONOMOUS_RUNS_ENABLED=true`.
- Authentication, RBAC, state, realtime, jobs, secrets, API routing, and deployment remain in the existing DeepSpace scaffold.

No parallel backend or general-purpose database was added. TimescaleDB is accessed only through a narrow read-only HTTPS telemetry bridge.

## Development

Use a supported Node version and authenticate before the first DeepSpace command:

```sh
npx deepspace auth login
npx deepspace app init
npm run validate
npm run build
npm run dev
```

The first two commands replace the scaffold's `__APP_ID__` with the server-minted immutable app ID. Never hand-write that ID.

## Secrets and modes

`.env.example` documents names only. Configure values in the encrypted store:

```sh
npx deepspace secrets set GROK_API_KEY=...
npx deepspace secrets set LIBRENMS_URL=... LIBRENMS_API_KEY=...
npx deepspace secrets set TIMESCALEDB_URL=... TIMESCALEDB_BRIDGE_TOKEN=...
```

Do not edit `.dev.vars`; DeepSpace regenerates it.

The dashboard works without external credentials using explicit demo adapters and a simulated settlement executor. Live settlement requires every XRPL setting plus `XRPL_EXECUTION_MODE=live`. The XRPL client rejects endpoints that do not identify themselves as Testnet or Devnet.

## XRPL Testnet setup

Use a disposable funded Testnet account only:

1. Store its seed as `XRPL_WALLET_SECRET`.
2. Set the Testnet WebSocket URL, RLUSD issuer/currency, and approved vendor destination.
3. Use `TrustLineManager.establish()` once to create the RLUSD trust line.
4. Verify funding with `TrustLineManager.balance()`.
5. Keep `XRPL_EXECUTION_MODE=simulated` until the trust line and destination are verified.
6. Set the mode to `live`, redeploy, then run the approved scenario.

`TransactionVerifier` independently checks that the submitted transaction is validated with `tesSUCCESS`.

## Demonstrations

- **Approved scenario:** `server1` trends from 82% to 91%; the model proposes 129 RLUSD to the allowlisted storage vendor; policy approves; settlement runs; the hash and complete audit chain are recorded.
- **Denial scenario:** the model proposes 4,700 RLUSD to an unknown vendor; deterministic policy denies it; the XRPL executor is never called; the denial is audited.

The action buttons are owner-only. Photon-style questions use `askPhoton`, which reads the same resource, action, and audit collections as the dashboard and contains no authorization or execution logic.

## Verification

```sh
npm run lint
npm run type-check
npm run test:unit
npm run test
npm run build
```

Unit tests cover schema failure, policy rules, denied-executor isolation, success hashes, and execution failure audits. Playwright continues to cover the DeepSpace runtime.
