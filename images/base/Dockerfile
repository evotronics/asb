# asb base image: Ubuntu with git, curl, ssh, and your user. Small, for
# lightweight tool or agent runs. The other asb images build FROM asb-base,
# so this is the only image that creates the user.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    less \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Create the sandbox user with your name / uid / gid so files created in
# mounted directories land on the host owned by you. `asb build` passes
# these from the user, uid, and gid settings (defaults match a typical
# first user).
ARG USERNAME=agent
ARG UID=1000
ARG GID=1000

# Free the target uid/gid if the base image already occupies them (ubuntu:24.04
# ships an `ubuntu` user at uid 1000), then create our user.
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

# HOME is the sandbox's home mount; tools installed there (pip --user,
# npm -g, installer scripts) persist across containers.
ENV HOME=/home/${USERNAME}
ENV PATH="${HOME}/.local/bin:${HOME}/.npm-global/bin:${PATH}"

CMD ["/bin/bash"]
