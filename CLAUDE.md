# Factory

A dispatcher that runs Claude Code lanes against a project's GitHub issue queue. Read README.md first;
docs/quickstart.md is the setup for a new install.

- Node 22.18+ with TypeScript run directly (type stripping): erasable syntax only (no enums, namespaces
  or parameter properties), and `.ts` extensions in imports.
- `src/queue.ts` must match the served project's prompts (`builder.md` and `common.md`; the starter kit's are
  in `templates/project/prompts/`). Change them together, and keep the tests in `test/queue.test.ts` passing.
- Nothing about one deployment goes in source: repos, addresses, machines, check names and IDs belong in
  Settings › Install (src/install.ts) or the env. Tests use made-up values (test/example-install.ts).
- Checks: `npm test` and `npm run check`, both clean.
- Every lane is dry until the owner switches it on (`lane <name> on`). Never switch a lane on yourself.
  Dry lanes only record what they would do.
- Never GitHub Copilot. Never put tokens or keys in commits, logs or issues.
