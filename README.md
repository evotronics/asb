# asb — Anything Sandbox

Run coding agents, or any code you don't fully trust, in disposable,
hardened Docker containers. Each **sandbox** is a named container definition
with its own home directory, workspace, extra mounts, ports, and limits. The
container runs as your uid/gid, so files it creates in its mounts are owned
by you, and **the mounts are its only writable windows onto the host**.

A typical workspace is an [mpm](https://github.com/evotronics/mpm) workspace
holding only the few repos a project needs, so an agent sees a scoped set of
checkouts.

> Status: early rewrite of a shell script (see
> [CHANGELOG.md](CHANGELOG.md)). See [PLAN.md](PLAN.md) for the design and
> roadmap.

## Install

Requires Node.js >= 22.12 and Docker (or a Docker compatible CLI such as
podman). The npm package, `@evotronics/asb`, is not published yet; install
from a checkout:

```sh
git clone https://github.com/evotronics/asb.git ~/src/asb
cd ~/src/asb && npm install && npm link   # provides `asb`
```

## Quick start

```sh
asb build                                 # build the default image with your uid/gid
asb new widget -w ~/sandboxes/widget -p 5173-5177
cd ~/sandboxes/widget
asb start                                 # the sandbox is found from the current directory
asb sh                                    # a shell in ~/workspace; run your agent here
asb sh npm test                           # or any command
asb stop                                  # the container is --rm; state lives in the mounts
```

`asb run <cmd>` runs a command in a throwaway container instead, and
`asb -n <command>` prints the docker command without running it, so you can
inspect it before you trust it.

## Commands

```
asb [global options] <command> [options] [args...]
```

| Command | Description |
|---|---|
| `new <name>` | Create a sandbox (`-w/--workspace`, `--home`, `--image`, `-m/--mount`, `-p/--port`, `--network`, `-d/--description`) |
| `rm <name>` | Remove a sandbox's file (its home and workspace are kept) |
| `ls` | Sandboxes with container state, image, and workspace |
| `show [name]` | Resolved settings (`--docker`: the `docker run` command) |
| `edit [name]` | Open the sandbox's file in `$VISUAL`/`$EDITOR`, then validate it |
| `build [images...]` | Build images (`--no-cache`, `--pull`); default: the current sandbox's image |
| `config get\|set\|unset\|path\|validate\|edit` | Settings, defaults, and images in `config.yaml` |
| `start [name]` / `up` | Start the container (detached, `--rm`) |
| `stop [names...]` / `down` | Stop containers |
| `restart [name]` | Stop if running, then start (to apply config changes) |
| `sh [cmd...]` / `shell`, `exec` | Run a shell or command in the running container |
| `run <cmd...>` | One-shot: throwaway container, run the command, remove it |
| `status [names...]` / `ps` | `docker ps` for sandbox containers |
| `logs [docker args]` | Container logs (`asb logs -f`) |

Global options: `-s/--sandbox <name>`, `-n/--dry-run`, `-v/--verbose`,
`--[no-]color`. `ls`, `show`, and `config get` take `--json`.

**Which sandbox:** `-s <name>` (or a name argument), then `$ASB_SANDBOX`,
then the sandbox whose workspace, home, or mount source contains the
current directory (the deepest match wins).

`sh` and `run` start in the container path of the current directory when it
is inside the workspace, a mount, or the home, so `cd ~/sandboxes/widget/repo
&& asb sh` lands in `~/workspace/repo`. asb options must come before the
command (`asb sh -s widget ls -la`).

## Configuration

All config lives in `~/.config/asb/` (or `$XDG_CONFIG_HOME/asb`, or
`$ASB_CONFIG_DIR`), never inside a sandbox's mounts, so a sandbox can't
change its own settings:

```
~/.config/asb/
  config.yaml            # settings, defaults for all sandboxes, images
  sandboxes/
    widget.yaml          # one file per sandbox; the file name is its name
```

Files are validated against the JSON Schemas in [`schemas/`](schemas). The
commands that edit them (`new`, `rm`, `config set|unset`) keep comments,
validate before writing, and show a diff with `-n`.

### Sandbox files

```yaml
# ~/.config/asb/sandboxes/widget.yaml
description: widget work, with only the widget repos checked out
image: default
# home: ~/.local/share/asb/homes/widget    # default, created on first start
workspace: ~/sandboxes/widget              # -> ~/workspace in the container
mounts:
  - ~/src/shared-fixtures:fixtures:ro      # SOURCE:TARGET[:ro]
  - source: /data/sets
    target: /data
    readonly: true
ports: [5173-5177, 9323, "127.0.0.1:8080:80"]
network: bridge
resources: {memory: 8g}
env: {NODE_ENV: development}
```

| Key | Default | Meaning |
|---|---|---|
| `description` | | Shown by `asb ls` |
| `image` | `default` | Image name, from `images` |
| `home` | `~/.local/share/asb/homes/<name>` | Host directory mounted as `$HOME` (`/home/<user>`) |
| `workspace` | *(none)* | Host directory mounted at `~/workspace` |
| `workdir` | `~/workspace`, else `~` | Container working directory |
| `mounts` | `[]` | Extra bind mounts; `SOURCE:TARGET[:ro\|rw]` or `{source, target, readonly}` |
| `protect` | see [below](#protected-paths) | Workspace paths mounted read-only |
| `ports` | `[]` | Published ports. A bare port or range keeps its number on the host; use `HOST:CONTAINER` or `IP:HOST:CONTAINER` to remap |
| `network` | `bridge` | `bridge`, `none`, or a Docker network name |
| `resources` | `{cpus: 4, memory: 16g, pids: 2048}` | Limits |
| `env` | `{}` | Container environment variables |
| `readonly` | `false` | Read-only root filesystem (the mounts stay writable) |
| `tmpExec` | `false` | Allow running executables from `/tmp` |
| `shell` | `/bin/bash` | What `asb sh` runs with no command |
| `runArgs` | `[]` | Extra `docker run` arguments, one per item. Use sparingly |

Host paths must be absolute or start with `~/`. Container targets that start
with `~` or are relative are in the container home.

### config.yaml

```yaml
# ~/.config/asb/config.yaml
version: 1
settings:
  user: agent          # user name in the container
  # uid: 1000          # default: yours
  # gid: 1000
  # docker: podman     # docker compatible CLI
defaults:              # applied to every sandbox
  resources: {cpus: 4, memory: 16g}
images:
  node:
    context: ~/src/images/node
    # dockerfile: Dockerfile
    # tag: asb-node
    # args: {NODE_MAJOR: "24"}
```

A sandbox's own values override `defaults`; `resources` and `env` merge key
by key, and lists replace. The `default` image is
[`images/default/Dockerfile`](images/default/Dockerfile). `asb build` passes
`USERNAME`, `UID`, and `GID` build args to every image.

```sh
asb config get --show-origin               # where each setting comes from
asb config set defaults.resources.memory 8g
asb config set docker podman
```

## Security model

The isolation boundary is deliberately simple: **the sandbox can read and
write only what you mount, as your uid, with a reduced kernel surface.**

What every container gets:

- **Non-root, your uid/gid**: `--user UID:GID`; created files are owned by
  you.
- **`--security-opt no-new-privileges`**: setuid binaries can't escalate.
- **`--cap-drop ALL`**: drops every Linux capability.
- **`--pids-limit`, `--cpus`, `--memory`**: resource ceilings.
- **`/tmp` is a `noexec,nosuid` tmpfs**: no running dropped payloads from
  `/tmp`.
- **`--rm`**: the container is disposable; state lives only in the mounts.
- **`--mount type=bind`**: a missing source is an error, instead of a root
  owned directory created by `-v`.
- Optional read-only root filesystem (`readonly: true`) and
  `network: none`.

### Protected paths

Anything in a writable mount that the *host* later runs is a way out of the
sandbox. With an mpm workspace mounted, a sandbox could add an alias to
`.mpm/config.yaml`, add a git hook, or set `core.fsmonitor` or
`core.hooksPath` in a repo's `.git/config`, which then runs the next time
you (or `mpm status`) run git on the host. So these workspace paths are
mounted read-only by default:

```yaml
protect:              # relative to the workspace; * matches one name
  - .mpm
  - .git/config
  - .git/hooks
  - '*/.git/config'
  - '*/.git/hooks'
```

A read-only `.git/config` makes git commands that write config fail in the
sandbox (`git remote add`, `git push -u`, `git branch -u`). Set your own
`protect` list, for example `protect: [.mpm]`, to loosen this for trusted
agents. Paths are found when the container starts, so repos cloned later are
not covered until a restart. `asb show` lists what is protected.

This is defense in depth, not a boundary: a determined process can rename a
repo directory and create a new one in its place. After running truly
untrusted code, review the workspace before running host tools in it.

### What it does not do

This is a container, not a VM: a kernel exploit escapes it. Don't add
`--privileged` or capabilities with `runArgs` unless you need them, and keep
mounts scoped to exactly what the sandbox should touch. For network egress
control, use `network: none`, or a custom Docker network with an egress
firewall or proxy (built-in allowlists are planned, see
[PLAN.md](PLAN.md)).

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | A docker command failed (`sh` and `run` return the command's own code) |
| 2 | Usage or config error |

## Development

```sh
npm test        # vitest; uses a fake docker, so Docker is not needed
npm run lint    # eslint (@digitalbazaar/eslint-config)
```

## License

BSD 3-Clause. See [LICENSE.md](LICENSE.md).
