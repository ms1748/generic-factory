# The agent image: one Claude Code run per container. Node 22, git, gh and Claude Code, as a non-root user;
# TAURI=1 adds Rust (clippy, rustfmt) and Tauri build deps for projects that need them (docker-compose.yml passes
# FACTORY_AGENT_TAURI from .env). A project's own tools go in an image built FROM this one
# (docs/quickstart.md). The dispatcher starts it with a repo-scoped token, CPU and memory limits and a
# shared cargo cache; it never gets the Docker socket or anything from the host.
FROM debian:trixie-slim

ARG DEBIAN_FRONTEND=noninteractive
ARG TAURI=0
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg git jq unzip openssl build-essential \
      $([ "$TAURI" = 1 ] && echo pkg-config file \
        libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev) \
 && install -d -m 755 /etc/apt/keyrings \
 && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/githubcli.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get install -y --no-install-recommends nodejs gh \
 && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /bin/bash agent \
 && install -d -o agent -g agent /work \
 && printf '#!/bin/sh\n# gh as the factory app: the dispatcher keeps a fresh repo-scoped token in this read-only file.\nGH_TOKEN="$(cat /run/factory/token)" exec /usr/bin/gh "$@"\n' > /usr/local/bin/gh \
 && chmod 755 /usr/local/bin/gh
USER agent
WORKDIR /home/agent
ENV PATH=/home/agent/.local/bin:/home/agent/.cargo/bin:$PATH \
    CARGO_HOME=/home/agent/.cargo

RUN curl -fsSL https://claude.ai/install.sh | bash && claude --version \
 && if [ "$TAURI" = 1 ]; then \
      curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal -c clippy,rustfmt \
      && cargo clippy --version; fi \
 && mkdir -p .cargo/registry .cargo/git .npm .claude/projects   # so the volumes start out owned by agent

# Trial (2026-10-27): two third-party skills, pinned to a reviewed commit; skills only, no hooks.
# Ponytail (MIT): the smallest complete change. Impeccable (Apache-2.0): design review for UI work; its
# engine binary is fetched here and checked against the skill's own engine-checksums.txt.
# Off since the 2026-10-28 trial (plain won both judged cards). SKILLS=1 builds them in, as factory-agent:skills.
ARG SKILLS=0
ARG PONYTAIL_SHA=09c434ab73ca43761c5d8b0c5d341926c2fba710
ARG IMPECCABLE_SHA=d34c87e1a00989ae8dbdd7f6b30b70f23319e860
RUN [ "$SKILLS" = 1 ] || exit 0; set -e; fetch() { git init -q "$1" && cd "$1" && git sparse-checkout set --no-cone "$4" \
      && git fetch -q --depth 1 --filter=blob:none "https://github.com/$2" "$3" && git checkout -q FETCH_HEAD && cd ..; }; \
    mkdir -p .claude/skills /tmp/skills && cd /tmp/skills \
 && fetch p dietrichgebert/ponytail "$PONYTAIL_SHA" "/skills/" && cp -r p/skills/ponytail* ~/.claude/skills/ \
 && fetch i pbakaus/impeccable "$IMPECCABLE_SHA" "/.claude/skills/impeccable/" && cp -r i/.claude/skills/impeccable ~/.claude/skills/ \
 && ~/.claude/skills/impeccable/scripts/impeccable engine-probe \
 && cd ~ && rm -rf /tmp/skills && ls ~/.claude/skills

COPY --chown=agent:agent --chmod=755 run.sh /home/agent/run.sh
# Never install or call GitHub Copilot here.
CMD ["/home/agent/run.sh"]
