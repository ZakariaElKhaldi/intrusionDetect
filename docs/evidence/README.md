# Reproducible evidence

`make benchmark` replaces `replay-benchmark.json` and `replay-benchmark.md` with a measured run against the current promoted models, a checksum-verified dataset, and a disposable SQLite database. Commit both files together after model promotion. Do not hand-edit measured values or describe the local run as a production load test.
