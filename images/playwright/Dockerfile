# syntax=docker/dockerfile:1
# asb playwright image: default plus the system libraries and fonts that
# Playwright's chromium, firefox, and webkit browsers need. The browsers
# themselves are installed per project (`npx playwright install`) into the
# home mount.
FROM asb-default

USER root

# Playwright installs the packages its browsers need on this Ubuntu release
# and CPU. Bump the version to match the Playwright your projects use.
ARG PLAYWRIGHT_VERSION=1.64.1
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    --mount=type=cache,target=/root/.npm \
    npm_config_cache=/root/.npm \
    npx -y playwright@${PLAYWRIGHT_VERSION} install-deps chromium firefox webkit

ARG USERNAME=agent
USER ${USERNAME}
