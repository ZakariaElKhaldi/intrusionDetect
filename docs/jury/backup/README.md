# Offline jury backup package

This directory is the checklist and recovery index. Media must be generated from the final promoted bundle after `make jury-preflight`; no synthetic screenshot or placeholder video may be presented as a real run.

## Required files before the jury

- `01-health.png` — clean demo health with checksum, bundle validity, both model versions and fallback disabled;
- `02-model-evidence.png` — detector candidate comparison and confusion matrix;
- `03-normal-completed.png` — completed normal replay with zero alerts;
- `04-attack-alerts.png` — completed attack replay and populated alert table;
- `05-alert-explanation.png` — one alert’s signed explanation and model versions;
- `jury-demo.webm` or `jury-demo.mp4` — one uninterrupted 4–5 minute rehearsal following `../demo-script.md`;
- a copy of `../../evidence/replay-benchmark.json`; and
- a PDF export of `../slides-en.md`.

The media files are intentionally absent until a final successful run is recorded. This avoids shipping screenshots or claims from obsolete models.

## Expected outputs

- `make jury-preflight` ends with `Jury preflight passed`.
- `make demo` reports a disposable database and serves the dashboard on port 4173.
- Fresh demo: zero alerts and no Fixture data badge.
- Normal replay: all requested rows processed, no alert events.
- Attack replay: persisted alerts with detector and classifier versions.
- Analyst status: remains changed after reload.

## Recovery order

1. Use screenshots while explaining the measured JSON evidence.
2. Play the local recording if the browser/backend cannot be recovered in 30 seconds.
3. Open the slide appendix for threshold, support and reproducibility questions.
4. State the failure honestly; never enable fixtures and imply that they are live results.
