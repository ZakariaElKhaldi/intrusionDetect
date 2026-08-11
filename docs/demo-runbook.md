# Presentation runbook

This runbook is for a reliable local presentation of the implemented system. It
does not turn the academic prototype into a validated production security
control.

## Before the presentation

From a clean checkout, install dependencies and fetch the checksummed dataset:

```bash
make setup
make download-data
make build
make demo-preflight
```

Run the browser acceptance path at least once on the presentation machine:

```bash
make e2e
```

The Playwright suite launches isolated backend and production-preview servers
with the real promoted model bundle. Its tests cover dataset replay, live alert
delivery, alert investigation, explanations, feedback persistence, all five
primary navigation destinations, serious/critical axe findings, and horizontal
overflow at the declared presentation viewports. Its disposable database does
not alter the presentation database.

## Launch

```bash
make demo
```

Wait for `Clean project demo is ready` before opening the printed dashboard URL.
Keep that terminal visible: it contains the one-time operator password and owns
cleanup. The launcher verifies the dataset checksum, migration state, promoted
models, frontend build, backend instance identity, and frontend proxy. It then
preloads eight normal and eight attack observations through the authenticated
replay API so every workspace has truthful data immediately.

Set `DEMO_SEED_RECORDS=0 make demo` only when the presentation needs to begin
from an empty database. Set `DEMO_BACKEND_PORT` and `DEMO_FRONTEND_PORT` if the
default ports are occupied.

## Suggested seven-minute walkthrough

1. **Overview:** point out the connected stream, persisted prediction count,
   alert workload, serving-path evidence, and seeded-data provenance.
2. **Live replay:** sign in with the printed credentials, select `attack`, keep
   the limit small (8–20), and start replay. New alerts arrive without a reload.
3. **Alerts:** open one alert, compare detector and attack-family stages, inspect
   signed feature contributions, then save analyst feedback with a reason.
4. **Topology:** show that the graph is derived from currently loaded alerts;
   it is not packet capture or complete network discovery.
5. **Models:** compare detector and classifier evaluation evidence and state the
   random-split limitation shown in the UI.
6. **Observation lab:** validate the supplied canonical sample, then explain the
   distinct immediate, durable-ingestion, and custom-replay paths.
7. **Operations:** return to Overview and show ingestion jobs, outbox evidence,
   worker status, and model-health evidence.

Use the UI's own qualification language. In particular, do not describe SHAP
attribution as causal, dataset replay order as chronology, or the RT-IoT2022
random split as deployment validation.

## Recovery

- If launch reports an occupied port, stop that process or choose alternate
  ports; the script will not attach to an unknown backend.
- If preflight reports a missing dataset, run `make download-data`.
- If preflight reports a missing frontend bundle, run `make build`.
- If a browser was opened before readiness, reload after the ready message.
- If a service exits, the launcher stops its sibling services and removes the
  disposable SQLite database. Rerun `make demo` for a clean state.
- Press `Ctrl-C` once to stop. No presentation records are retained.
