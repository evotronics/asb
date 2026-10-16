# syntax=docker/dockerfile:1
# Example personal image: the default image plus an editor and terminal
# tools for interactive shells. Copy it to make it yours, then edit:
#
#   cp -r examples/images/dev ~/.config/asb/images/
#   asb build dev
#   asb config set defaults.image dev    # use it for every sandbox
FROM asb-default

# Install as root, then switch back to the sandbox user at the end.
USER root

# The cache mounts keep package downloads out of the image and reuse them
# across builds.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    btop \
    fzf \
    htop \
    tig \
    tmux \
    vim

ENV EDITOR=vim

ARG USERNAME=agent
USER ${USERNAME}
