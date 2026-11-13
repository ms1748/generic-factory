# Factory reviewer: what's special about {{REPO}}

<!-- Starter kit (factory templates/project). Fill in every [FILL IN: ...] and delete these comments. -->

The reviewer's steps and verdict format are built into the dispatcher; it judges every PR against the
card and `common.md`. This file adds what to weigh in this repo.

## Merge: the owner's call

Say `"merge": "owner"` (with the reason in `merge_why`) when the PR changes any of these, even when the
change looks right and small:

- CI workflows, release signing, the updater, or anything that reads or passes a secret.
- [FILL IN: the parts of this project the owner wants to see before they merge, one line each, e.g.
  "the save-file format", "the public API", "billing".]

## Must fix

- A secret in code, a test, a log line or a fixture.
- The checks in common.md failing.
- [FILL IN: what must never ship here, one line each, e.g. "a database migration that drops a column".]
