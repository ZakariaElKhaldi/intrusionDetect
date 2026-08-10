# Dataset replay benchmark

Measured: `2026-08-10T21:30:45.136157+00:00` against the promoted cascade.
Both scenarios use server-managed RT-IoT2022 replay, interval 0, and a clean SQLite database.

| Scenario | Processed | Alerts | WS prediction / alert events | Failures | Throughput obs/s | E2E p50 / p95 ms |
|---|---:|---:|---:|---:|---:|---:|
| normal | 200 | 0 | 200 / 0 | 0 | 57.240 | 15.896 / 20.108 |
| attack | 200 | 196 | 200 / 196 | 0 | 23.543 | 40.142 / 43.646 |

Latency is measured inside the application from observation processing start through database commit and response construction. Wall-clock throughput additionally includes HTTP polling and scheduler overhead. This is a local demonstration benchmark, not a capacity or production load test.
