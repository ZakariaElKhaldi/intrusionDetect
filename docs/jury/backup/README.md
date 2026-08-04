# Offline jury backup package

This directory is the recovery package captured from the promoted bundle on
2026-08-04 after the automated jury checks. The screenshots are real connected
UI states. `jury-demo.webm` is a short silent slideshow of those states, not a
recording of a narrated rehearsal.

## Included files

- `01-health.png` — clean demo health with checksum, bundle validity, both model versions and fallback disabled;
- `02-model-evidence.png` — detector candidate comparison and confusion matrix;
- `03-normal-completed.png` — completed normal replay with zero alerts;
- `04-attack-alerts.png` — completed attack replay and populated alert table;
- `05-alert-explanation.png` — one alert’s signed explanation and model versions;
- `jury-demo.webm` — short visual fallback assembled from the captured states;
- `replay-benchmark.json` — a copy of the measured benchmark evidence.

Before the jury, record a narrated 4–5 minute rehearsal following
`../demo-script.md` and export `../slides-en.md` to PDF. Those human presentation
artifacts cannot be generated or validated as a truthful defense automatically.

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
