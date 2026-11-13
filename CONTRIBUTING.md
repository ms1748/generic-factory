# Contributing

Thanks for helping. Small, focused changes are easiest to review: one fix or feature per pull request.

## Before you open a PR

```bash
npm ci
npm test            # every test passes
npm run check       # 0 type errors
npm run build:web   # only if you changed web/
```

Dashboard changes: run the page against the fixture (`npm run dev:fixture`) and look at it.

## How the code is written

- Node 22.18+ runs the TypeScript directly (type stripping): erasable syntax only (no enums, namespaces
  or parameter properties), and `.ts` extensions in imports.
- Pure logic in its own module with a test in `test/`; I/O at the edges (`src/github.ts`, `src/state.ts`,
  `src/runner.ts`).
- New state goes through `src/state.ts`, and old databases keep working: add tables and columns, never
  drop or rename them.
- The only runtime dependency is `yaml`. Don't add one when Node already does the job.
- `src/queue.ts` must match the queue rules in the project prompts (`builder.md` and `common.md`; the
  starter kit's are in `templates/project/prompts/`); change them together.
- Update `README.md`'s file map and how-it-works sections when behaviour changes.

## No deployment-specific values in source

Nothing about one install goes in the code, the tests or the docs outside `examples/`: no repo names,
addresses, host names, machine names, check names, account IDs or emails. They belong in the dashboard's
Settings › Install (`src/install.ts`) or the env. Tests use made-up values (`test/example-install.ts`,
`example.com`).

Never put a token, key or `.env` value in a commit, an issue or a log. New settings go in `.env.example`
with an empty value.

## Safety rules

- New lanes, switches and GitHub actions start **dry or off**; the owner turns them on from the dashboard.
- Owner switches go on the dashboard, not in files, env vars or commands.
- Changes to how agent containers start (`agent/Dockerfile`, `src/runner.ts`), to tokens and access
  (`src/github.ts`, `src/access.ts`, webhook checks), or to auto-merge (`src/automerge.ts`) get a close
  review: say why in the PR.

Security problems: see SECURITY.md, not a public issue.
