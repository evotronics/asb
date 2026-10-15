FROM ubuntu:24.04

# Avoid prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install essential packages
RUN apt-get update && apt-get install -y \
    curl \
    git \
    build-essential \
    python3 \
    python3-pip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install less essential packages
RUN apt-get update && apt-get install -y \
    vim \
    rsync \
    jq \
    tree \
    fzf \
    htop \
    btop \
    tig \
    bash-completion \
    lsof \
    ripgrep \
    tmux \
    && rm -rf /var/lib/apt/lists/*

# Install playwright deps for "chromium" + "firefox" + "webkit"
# ./node_modules/.bin/playwright install-deps --dry-run chromium firefox webkitjw
RUN apt-get update && apt-get install -y --no-install-recommends \
    libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 libcairo2 libcups2t64 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 xvfb fonts-noto-color-emoji fonts-unifont libfontconfig1 libfreetype6 xfonts-cyrillic xfonts-scalable fonts-liberation fonts-ipafont-gothic fonts-wqy-zenhei fonts-tlwg-loma-otf fonts-freefont-ttf \
    libasound2t64 libatk1.0-0t64 libcairo-gobject2 libcairo2 libdbus-1-3 libfontconfig1 libfreetype6 libgdk-pixbuf-2.0-0 libglib2.0-0t64 libgtk-3-0t64 libpango-1.0-0 libpangocairo-1.0-0 libx11-6 libx11-xcb1 libxcb-shm0 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 xvfb fonts-noto-color-emoji fonts-unifont xfonts-cyrillic xfonts-scalable fonts-liberation fonts-ipafont-gothic fonts-wqy-zenhei fonts-tlwg-loma-otf fonts-freefont-ttf \
    gstreamer1.0-libav gstreamer1.0-plugins-bad gstreamer1.0-plugins-base gstreamer1.0-plugins-good libicu74 libatomic1 libatk-bridge2.0-0t64 libatk1.0-0t64 libcairo-gobject2 libcairo2 libdbus-1-3 libdrm2 libenchant-2-2 libepoxy0 libevent-2.1-7t64 libflite1 libfontconfig1 libfreetype6 libgbm1 libgdk-pixbuf-2.0-0 libgles2 libglib2.0-0t64 libgstreamer-gl1.0-0 libgstreamer-plugins-bad1.0-0 libgstreamer-plugins-base1.0-0 libgstreamer1.0-0 libgtk-4-1 libharfbuzz-icu0 libharfbuzz0b libhyphen0 libjpeg-turbo8 liblcms2-2 libmanette-0.2-0 libopus0 libpango-1.0-0 libpangocairo-1.0-0 libpng16-16t64 libsecret-1-0 libvpx9 libwayland-client0 libwayland-egl1 libwayland-server0 libwebp7 libwebpdemux2 libwoff1 libx11-6 libxkbcommon0 libxml2 libxslt1.1 libx264-164 libavif16 xvfb fonts-noto-color-emoji fonts-unifont xfonts-cyrillic xfonts-scalable fonts-liberation fonts-ipafont-gothic fonts-wqy-zenhei fonts-tlwg-loma-otf fonts-freefont-ttf \
    && rm -rf /var/lib/apt/lists/*

# Install necessary packages and the GitHub CLI
RUN apt update && apt install -y curl gnupg \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | gpg --dearmor -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt update \
    && apt install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js (using NodeSource for latest LTS)
RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
#RUN npm install -g @anthropic-ai/claude-code

# Create the sandbox user with a configurable name / uid / gid so files created
# in the container land on the host owned by the invoking user. These are
# supplied by `asb build` (settings user, uid, gid; defaults match a typical
# first user).
ARG USERNAME=agent
ARG UID=1000
ARG GID=1000

# Free the target uid/gid if the base image already occupies them (ubuntu:24.04
# ships an `ubuntu` user at uid 1000), then create our user. Idempotent-ish.
RUN set -eux; \
    if getent passwd "${UID}" >/dev/null; then \
        userdel -r "$(getent passwd "${UID}" | cut -d: -f1)" 2>/dev/null || true; \
    fi; \
    if ! getent group "${GID}" >/dev/null; then \
        groupadd -g "${GID}" "${USERNAME}"; \
    fi; \
    useradd -m -u "${UID}" -g "${GID}" -s /bin/bash "${USERNAME}"

# Set working directory
WORKDIR /home/${USERNAME}/workspace

# Switch to non-root user
USER ${USERNAME}

# Set up a basic shell environment
ENV HOME=/home/${USERNAME}
ENV PATH="${HOME}/.npm-global/bin:${PATH}"

CMD ["/bin/bash"]
