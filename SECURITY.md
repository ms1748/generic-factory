# Security

The factory runs AI agents with write access to your repos, on a machine you own. Its safety rests on a
few rules; a problem with any of them is a security problem.

## Reporting a problem

Please report it privately: on GitHub, this repo's **Security** tab › **Report a vulnerability**. Don't
open a public issue for it. Say what you found, how to reproduce it, and what it lets someone do. You'll
should hear back within a week, and get credit in the fix unless you'd rather not.

Worth reporting, for example:

- a way for an agent run, a PR's code or a CI job to reach the dispatcher's secrets (the GitHub App's
  private key, the Claude token, `.env`), the Docker socket, or the host;
- a way to use the dashboard's controls without the owner's sign-in;
- a way for someone other than the owner to steer the factory through GitHub (comments, labels, PRs);
- a secret written to a log, a transcript, a comment or a commit.

## How it's meant to be deployed

- **Agents get one repo and nothing else.** Each run is a fresh container with a short-lived token for one
  repo, no Docker socket, no host files and no Linux capabilities. The dispatcher, which holds the keys,
  never runs agent code.
- **The dashboard opens only for the owner:** through Cloudflare Access or the built-in sign-in
  (docs/deploy.md, "Reach the dashboard"). Agents and CI on the same network run code nobody has read
  yet, so "came from the LAN" isn't trusted.
- **Self-hosted CI runners never serve a public repo's PRs.** A public repo's pull requests run the
  author's code on your runner. Keep self-hosted runners for private repos (or for jobs that never run PR
  code, such as releases from protected branches), keep them off the factory's machine, and give them no
  secrets they don't need. GitHub's own advice is the same.
- **Release secrets live in a protected GitHub environment** (owner approval, tags only), never as plain
  repo secrets: any branch an agent pushes can run workflows.
- **Every lane starts dry.** Nothing the factory does on GitHub happens until the owner switches it on.

## Publishing a copy

`scripts/publish-snapshot.sh` builds a single-commit public copy and refuses if it finds secrets or any
of your private values (docs/deploy.md and the script's header). Read the copy before you push it.
