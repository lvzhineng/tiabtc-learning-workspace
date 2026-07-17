# Offline market data snapshot

`tiabtc-review-seed.sqlite` is the immutable SQLite seed used for offline chart review. It is
stored with Git LFS. On the first `python study_server.py` run, the server copies it to the
ignored runtime database at the repository root (`tiabtc-review.sqlite`).

The runtime database contains mutable settings and drawings and must not be committed. To
publish a refreshed market-data snapshot, stop the server, verify the runtime database, copy
it over this seed file, and commit the resulting LFS object deliberately.
