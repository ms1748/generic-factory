# Changelog

History of the install this repo was built in, moved out of the README.

## Skills trial (2026-10-27/28): dropped

Result: the plain image won both judged cards. The skills builds were about 10% cheaper and a
third smaller, but less complete. They missed parts of the card, so both skills are off. The
Dockerfile can still build them with `--build-arg SKILLS=1` (plus `TAURI=1` for a project that needs Rust or Tauri), as `factory-agent:skills`, to try again:

- [Ponytail](https://github.com/dietrichgebert/ponytail) (MIT): the smallest complete change.
- [Impeccable](https://github.com/pbakaus/impeccable) (Apache-2.0): design review for UI and website work.

An image built with them tells agents to use them (its note in `src/prompt.ts`). Compare runs from before and after this date on the
dashboard (usage, cost, time per run) and in PR quality. **Quality trial:** `node src/main.ts trial <issue>... [--at HH:MM]` rebuilds past cards twice from
the code before their real PR: once with the skills, once with `factory-agent:plain`
(`docker build --build-arg SKILLS=0 -t factory-agent:plain agent`, plus `--build-arg TAURI=1` for a Rust or Tauri project). The builds go on `trial/*` branches,
never PRs. A fresh Opus judge then runs the checks on both and scores them blind. The report goes to
`data/trials/<time>.md`. To drop one, remove its lines from the
Dockerfile and its note from `src/prompt.ts`. To update one, review the new commit and change
its `*_SHA`.

## Roadmap notes (as of 2026-11)

1. Done: SQLite state and live runs in the agent image, pausing on usage limits. Up to 3 at once since
   2026-11-08 (Settings › Parallel runs); two runs never take the same card or PR.
2. Done: an owner reply on a factory PR resumes that PR's own session (webhooks plus polling).
3. Done: the dashboard, behind Cloudflare Access.
4. Done: builder and small-builder live.
5. Done: the reviewer lane. Next: require its `factory/review` status on `main` once
   it's proved reliable, then ntfy notifications.
