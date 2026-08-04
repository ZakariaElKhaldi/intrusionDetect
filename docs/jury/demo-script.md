# Jury demo script — 4 to 5 minutes

## Before entering the room

1. Run `make jury-preflight` and save the terminal output.
2. Run `make benchmark` only if the promoted model changed; commit both evidence files.
3. Run `make demo`. Keep API docs closed unless asked.
4. Confirm the health panel reports the dataset checksum, both production versions, a valid bundle and no fallback.
5. Keep [`backup/README.md`](backup/README.md) available offline.

## Live sequence

**0:00–0:35 — Start from evidence.** Open System health. Say: “This is a clean disposable database, a checksum-verified recorded dataset and the promoted two-stage cascade. No retraining occurs during the demo.”

**0:35–1:10 — Show provenance and models.** Open Models. Switch between Detector and Classifier. Point once to the selected champion, test metric, support and confusion matrix. Say that the shared random split is not deployment validation.

**1:10–1:45 — Normal traffic.** Select Normal, limit 8–20, interval zero or fastest speed, then Start. Show progress reaching completion. Point to the increased prediction count and zero alert count.

**1:45–2:35 — Attack traffic.** Select Attack, limit 8–20, then Start. Briefly demonstrate Pause and Resume if time allows. Wait for Completed and open Alerts.

**2:35–3:45 — Investigate one alert.** Open the first alert. Point to the detector version, classifier version, predicted family and raw route evidence. Load the explanation. Describe one positive and one negative signed contribution. Say: “This explains model behavior, not causality.”

**3:45–4:15 — Analyst loop.** Choose Start investigation or Resolve, close the drawer, reload, and show that the state remains persisted.

**4:15–4:45 — Close with scope.** Return to Models or Overview. Say: “The defended result is reproducible dataset replay and end-to-end investigation. Live capture, drift and production security are future validation work.”

## Recovery

- If the UI says Offline, keep the terminal visible and rerun `make demo` after stopping the old process.
- If a replay fails, show the explicit error, use Stop, and restart the disposable demo. Do not switch to fixture mode without stating it.
- If projection or networking fails, use the offline screenshots and recording; show the committed JSON evidence separately.
- Never retrain during the presentation.
