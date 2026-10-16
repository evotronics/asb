# asb default image: base plus common development tools (compilers, Node.js,
# Python with uv, the GitHub CLI, search, JSON, and lint tools). No editor or
# other personal tools: build your own image FROM asb-default for those.
FROM asb-base

# Install as root, then switch back to the sandbox user at the end.
USER root

# python3 is for node-gyp (native npm modules) and quick scripts. There is
# no pip: Ubuntu's system Python refuses pip installs; use uv instead.
RUN apt-get update && apt-get install -y \
    bash-completion \
    build-essential \
    fd-find \
    file \
    jq \
    lsof \
    python3 \
    ripgrep \
    rsync \
    shellcheck \
    sqlite3 \
    tree \
    unzip \
    xz-utils \
    zip \
    && rm -rf /var/lib/apt/lists/*

# Ubuntu names fd "fdfind"
RUN ln -s /usr/bin/fdfind /usr/local/bin/fd

# uv: uvx runs Python tools and MCP servers (like npx), and uv makes
# virtualenvs. Pinned; COPY --from can't use build args, so change the
# version here.
COPY --from=ghcr.io/astral-sh/uv:0.13.1 /uv /uvx /usr/local/bin/

# GitHub CLI
RUN curl -fsSL -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
        https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Node.js (current LTS, from NodeSource)
RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# ast-grep (ast-grep and sg): structural code search and rewrites. Installed
# in /usr/local: anything under the home directory is hidden by the
# sandbox's home mount.
RUN npm install -g --prefix /usr/local @ast-grep/cli

# `npm install -g` in a sandbox goes to its home mount, as the sandbox user
ENV NPM_CONFIG_PREFIX=${HOME}/.npm-global

ARG USERNAME=agent
USER ${USERNAME}
