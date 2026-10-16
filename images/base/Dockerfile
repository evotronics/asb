# syntax=docker/dockerfile:1
# asb base image: Ubuntu with git, curl, ssh, and your user. Small, for
# lightweight tool or agent runs. The other asb images build FROM asb-base,
# so this is the only image that creates the user.
FROM ubuntu:26.04

ENV DEBIAN_FRONTEND=noninteractive
# ubuntu sets no locale; without one, some tools mangle non-ASCII text
ENV LANG=C.UTF-8

# Keep downloaded packages, for the apt cache mounts below and in images
# built from this one: downloads are reused across builds (even with
# --no-cache) and stay out of the image layers.
RUN rm -f /etc/apt/apt.conf.d/docker-clean \
    && echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' \
        > /etc/apt/apt.conf.d/keep-cache

# procps: ps, kill, pkill, top (not in the ubuntu image)
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    less \
    openssh-client \
    procps

# Create the sandbox user with your name / uid / gid so files created in
# mounted directories land on the host owned by you. `asb build` passes
# these from the user, uid, and gid settings (defaults match a typical
# first user).
ARG USERNAME=agent
ARG UID=1000
ARG GID=1000

# Free the target uid/gid if the base image already occupies them (the
# ubuntu image ships an `ubuntu` user at uid 1000), then create our user.
RUN set -eux; \
    if getent passwd "${UID}" >/dev/null; then \
        userdel -r "$(getent passwd "${UID}" | cut -d: -f1)" 2>/dev/null || true; \
    fi; \
    if ! getent group "${GID}" >/dev/null; then \
        groupadd -g "${GID}" "${USERNAME}"; \
    fi; \
    useradd -m -u "${UID}" -g "${GID}" -s /bin/bash "${USERNAME}"

WORKDIR /home/${USERNAME}/workspace
USER ${USERNAME}

# HOME is the sandbox's home mount; tools installed there (uv tool install,
# npm -g, installer scripts) persist across containers.
ENV HOME=/home/${USERNAME}
ENV PATH="${HOME}/.local/bin:${HOME}/.npm-global/bin:${PATH}"

CMD ["/bin/bash"]
