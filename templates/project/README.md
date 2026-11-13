# Starter kit for a new project

What a repo needs before the factory can work its issues: the agents' prompt files, a `.factory.yml`,
and the factory's labels. One command sets it all up:

```bash
docker compose exec dispatcher node src/main.ts init-project <owner/repo>           # labels + a PR
docker compose exec dispatcher node src/main.ts init-project <owner/repo> --print   # only show what it would do
```

Install the factory's GitHub App on the repo first. The command:

1. creates the labels the factory reads (`ready`, `p1`-`p3`, `size:S`-`size:XL`, `building`, `review`,
   `hold`, `needs-owner`, `factory-stop` and the rest; the list is `src/labels.ts`), leaving any that
   already exist as they are;
2. opens a PR (labelled `factory`) that adds what's missing of:
   - `prompts/*.md` here, as `<prompt_dir>/` in the repo (`docs/factory/prompts/` unless its
     `.factory.yml` says otherwise): `common.md` (rules every agent follows), `builder.md`,
     `maintainer.md`, `ideas.md`, `security.md` and `reviewer.md`;
   - `.factory.yml`: the factory's default lanes written out.

   Files the repo already has are left alone. `{{REPO}}` and `{{PROMPT_DIR}}` are filled in for you.

**Then fill in the placeholders.** Search the PR's files for `[FILL IN:` and replace each with your
project's details: what it is, its checks (the commands that must pass), its conventions, what needs
your hardware. Delete the `<!-- Starter kit ... -->` comments. Merge the PR, and switch one lane on
from the dashboard when you're ready.

**Keep the marked parts.** The sections marked "(the dispatcher relies on this)", the card-picking rules
in `builder.md` and its `claude/issue-<n>-<slug>` branch names are what the factory's queue reads
(`src/queue.ts`). Changing them there without changing the factory makes the queue and the agents
disagree quietly. The factory's tests check these templates still mention every one of them.
