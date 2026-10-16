# asb default image: base plus common development tools (compilers, Python,
# Node.js, the GitHub CLI, search and JSON tools). No editor or other personal
# tools: build your own image FROM asb-default for those.
FROM asb-base

# Install as root, then switch back to the sandbox user at the end.
USER root

RUN apt-get update && apt-get install -y \
    bash-completion \
    build-essential \
    jq \
    lsof \
    python3 \
    python3-pip \
    python3-venv \
    ripgrep \
    rsync \
    tree \
    unzip \
    && rm -rf /var/lib/apt/lists/*

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

# `npm install -g` goes to the home mount, as the sandbox user
ENV NPM_CONFIG_PREFIX=${HOME}/.npm-global

ARG USERNAME=agent
USER ${USERNAME}
