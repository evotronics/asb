# Example personal image: the default image plus an editor and terminal
# tools for interactive shells. Copy it to make it yours, then edit:
#
#   cp -r examples/images/dev ~/.config/asb/images/
#   asb build dev
#   asb config set defaults.image dev    # use it for every sandbox
FROM asb-default

# Install as root, then switch back to the sandbox user at the end.
USER root

RUN apt-get update && apt-get install -y \
    btop \
    fzf \
    htop \
    tig \
    tmux \
    vim \
    && rm -rf /var/lib/apt/lists/*

ENV EDITOR=vim

ARG USERNAME=agent
USER ${USERNAME}
