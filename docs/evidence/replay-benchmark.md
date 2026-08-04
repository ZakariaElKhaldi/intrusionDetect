# Dataset replay benchmark

Measured: `2026-08-04T22:44:00.921355+00:00` against the promoted cascade.
Both scenarios use server-managed RT-IoT2022 replay, interval 0, and a clean SQLite database.

| Scenario | Processed | Alerts | WS prediction / alert events | Failures | Throughput obs/s | E2E p50 / p95 ms |
|---|---:|---:|---:|---:|---:|---:|
| normal | 200 | 0 | 200 / 0 | 0 | 75.701 | 11.764 / 15.983 |
| attack | 200 | 192 | 200 / 192 | 0 | 31.245 | 30.127 / 32.088 |

Latency is measured inside the application from observation processing start through database commit and response construction. Wall-clock throughput additionally includes HTTP polling and scheduler overhead. This is a local demonstration benchmark, not a capacity or production load test.
