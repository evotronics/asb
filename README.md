# asb — Anything Sandbox

Run coding agents, or any code you don't fully trust, in disposable,
hardened Docker containers. Each **sandbox** is a named container definition
with its own home directory, workspace, extra mounts, ports, and limits. The
container runs as your uid/gid, so files it creates in its mounts are owned
by you, and **the mounts are its only writable windows onto the host**.

asb works well with [mpm](https://github.com/evotronics/mpm): an mpm
workspace holding only the repos a project needs makes a scoped workspace for
a sandbox, so an agent sees just those checkouts.

## Install

Requires Node.js >= 22.12 and Docker (or a Docker compatible CLI such as
podman).

From npm:

```sh
npm install -g @evotronics/asb   # provides `asb` (and `anything-sandbox`)
```

Or from a checkout:

```sh
git clone https://github.com/evotronics/asb.git ~/src/asb
cd ~/src/asb && npm install && npm link
```

## Quick start

```sh
asb build                                 # build the default image (and base) with your uid/gid
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
| `image ls` | Built-in and your images, whether they are built, and what each is built from |
| `image new <name>` | Create an image directory (`--from <image>`, `--copy <image>`, `-d`) |
| `image show [name]` | An image's files, tag, args, and base images |
| `audit [name]` | Check the sandbox's mounts for things the host would run (`--accept`, `--all`); see [Audit](#audit) |
| `build [images...]` | Build images and the asb images they are built from (`--no-bases`, `--no-cache`, `--pull`); default: the current sandbox's image |
| `config get\|set\|unset\|path\|validate\|edit` | Settings and sandbox defaults in `config.yaml` |
| `completion bash\|zsh\|fish` | Print a shell completion script |
| `start [name]` / `up` | Start the container (detached, `--rm`) |
| `stop [names...]` / `down` | Stop containers |
| `restart [name]` | Stop if running, then start (to apply config changes) |
| `sh [cmd...]` / `shell`, `exec` | Run a shell or command in the running container |
| `run <cmd...>` | One-shot: throwaway container, run the command, remove it |
| `status [names...]` / `ps` | `docker ps` for sandbox containers |
| `logs [docker args]` | Container logs (`asb logs -f`) |

Global options: `-s/--sandbox <name>`, `-n/--dry-run`, `-v/--verbose`,
`--[no-]color`. `ls`, `show`, `image ls`, `image show`, `audit`, and
`config get` take `--json`.

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
  config.yaml            # settings and defaults for all sandboxes
  sandboxes/
    widget.yaml          # one file per sandbox; the file name is its name
  images/
    dev/                 # one directory per image; see Images below
      Dockerfile
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
ports: [5173-5177, 9323, "8080:80"]       # on 127.0.0.1; "0.0.0.0:9323" for all
network: bridge
resources: {memory: 8g}
env: {NODE_ENV: development}
```

| Key | Default | Meaning |
|---|---|---|
| `description` | | Shown by `asb ls` |
| `image` | `default` | Image name; see [Images](#images) |
| `home` | `~/.local/share/asb/homes/<name>` | Host directory mounted as `$HOME` (`/home/<user>`) |
| `workspace` | *(none)* | Host directory mounted at `~/workspace` |
| `workdir` | `~/workspace`, else `~` | Container working directory |
| `mounts` | `[]` | Extra bind mounts; `SOURCE:TARGET[:ro\|rw]` or `{source, target, readonly}` |
| `protect` | see [below](#protected-paths) | Workspace paths mounted read-only |
| `ports` | `[]` | Published ports, on 127.0.0.1 only unless you give an address (`0.0.0.0:9323` for every interface). A port or range without a host port keeps its number on the host; use `HOST:CONTAINER` or `IP:HOST:CONTAINER` to remap |
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
  # git: git           # git on the host, for audit and doctor
defaults:              # applied to every sandbox
  image: dev
  resources: {cpus: 4, memory: 16g}
```

A sandbox's own values override `defaults`; `resources` and `env` merge key
by key, and lists replace. `user`, `uid`, and `gid` are also passed to every
image build (see [Images](#images)).

```sh
asb config get --show-origin               # where each setting comes from
asb config set defaults.resources.memory 8g
asb config set docker podman
```

## Images

An image is a **directory**: a Dockerfile plus anything it `COPY`s. That
directory is Docker's *build context*, the set of files sent to the build and
the only files `COPY` and `ADD` can see, which is why the files an image
needs sit next to its Dockerfile.

### Built-in images

Each builds on the one before it:

| Image | Built from | Adds | Use it for |
|---|---|---|---|
| `base` | `ubuntu:26.04` | git, curl, ssh, less, procps (`ps`, `kill`), a UTF-8 locale, and your user | Lightweight tool or agent runs |
| `default` | `base` | build-essential, Node.js LTS, Python with uv, gh, ripgrep, fd, jq, ast-grep, shellcheck, sqlite3, zip | General development; sandboxes use it unless they set `image` |
| `playwright` | `default` | System libraries and fonts for Playwright's chromium, firefox, and webkit, from `playwright install-deps` (pinned version) | Browser tests |

They live in asb's [`images/`](images) directory. None of them has an
editor or other personal tools: those go in an image of your own built from
one of these.

### Your images

Your images go in `~/.config/asb/images/<name>/`, one directory each, and are
tagged `asb-<name>`. A directory named after a built-in image (for example
`default`) replaces it, and images built from that one then build on yours.

```
~/.config/asb/images/
  dev/
    Dockerfile           # required, unless image.yaml sets context
    image.yaml           # optional
    bashrc               # anything the Dockerfile COPYs
```

| `image.yaml` key | Default | Meaning |
|---|---|---|
| `description` | | Shown by `asb image ls` |
| `tag` | `asb-<name>` | Docker image tag |
| `args` | `{}` | Build args, in addition to `USERNAME`, `UID`, and `GID` |
| `context` | this directory | Build somewhere else; absolute, `~/...`, or relative to this directory |
| `dockerfile` | `Dockerfile` | Dockerfile path, relative to the context |

### How builds work

- **Your user.** `asb build` passes `USERNAME`, `UID`, and `GID` build args
  (from the `user`, `uid`, and `gid` settings) to every image. `base` uses
  them to create a user matching you, so files a sandbox creates in its
  mounts are owned by you. Images built from it already have that user; they
  install packages as root and switch back:

  ```dockerfile
  # syntax=docker/dockerfile:1
  FROM asb-default
  USER root
  RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
      --mount=type=cache,target=/var/lib/apt,sharing=locked \
      apt-get update && apt-get install -y --no-install-recommends vim
  ARG USERNAME=agent
  USER ${USERNAME}
  ```

- **apt cache mounts.** The built-in images keep apt's package lists and
  downloads in BuildKit cache mounts (as above), so rebuilds reuse them,
  even with `--no-cache`, and they stay out of the image layers. `base`
  configures apt to keep downloads for this, so use the mounts in your
  images too; a plain `apt-get install` would leave the downloaded
  packages in your image. BuildKit is the default since Docker 23, and
  podman supports cache mounts.

- **Base images first.** A `FROM` line naming another asb image's tag
  (`FROM asb-default`) makes `asb build` build that image first, so
  `asb build playwright` builds base, default, and playwright. Docker's
  layer cache makes unchanged images quick. `--no-bases` builds only the
  named images. `FROM ${VARIABLE}` is not detected.
- **Install outside `$HOME`.** At runtime the sandbox's home mount replaces
  `/home/<user>`, hiding anything a Dockerfile put there. Install with apt,
  or into `/usr/local`: `npm install -g --prefix /usr/local <tool>` (the
  default image points npm's global prefix into the home, so the prefix
  is needed), or `COPY` binaries to `/usr/local/bin`.
- **Rebuilding.** Run `asb build` again after editing an image. Running
  containers keep the image they started with until `asb restart`. After
  changing `user`, `uid`, or `gid`, rebuild your images.

`asb image ls` lists all images and `asb image show <name>` shows an image's
files and what it is built from.

### Common setups

**Use the built-ins.** `asb build` builds `default` (and `base`), which
every sandbox uses by default. For browser tests, set `image: playwright` in
the sandbox, run `asb build playwright`, then `npx playwright install` in
the sandbox: the browsers download into its home. The image's system
packages come from a pinned Playwright version (`PLAYWRIGHT_VERSION` in its
Dockerfile); if a project's newer Playwright needs more, copy the image
(`asb image new playwright --copy playwright`) and raise the version.

**A personal image for interactive shells**, with your editor and tools:

```sh
asb image new dev -d "my shell tools"     # a Dockerfile FROM asb-default
$EDITOR ~/.config/asb/images/dev/Dockerfile
asb build dev
asb config set defaults.image dev         # for every sandbox; or image: dev in one
```

[`examples/images/dev`](examples/images/dev) is a ready-made one with vim,
tmux, tig, fzf, htop, and btop. Copy it, then edit it:

```sh
cp -r "$(npm root -g)/@evotronics/asb/examples/images/dev" ~/.config/asb/images/
# or, from a checkout: cp -r examples/images/dev ~/.config/asb/images/
```

Shell config every sandbox should share (a system `bashrc`, `vimrc`) can be
`COPY`ed into the image; per-sandbox config belongs in that sandbox's home.

**Lightweight runs** of a tool or agent, with the small `base` image:

```yaml
# ~/.config/asb/sandboxes/tool.yaml
image: base
workspace: ~/scratch/tool
network: none
resources: {cpus: 1, memory: 1g, pids: 256}
```

```sh
asb build base
asb -s tool run ./check.sh                # a throwaway container per run
```

**Change a built-in image completely.** `asb image new mine --copy default`
copies the whole build context to `~/.config/asb/images/mine/` to edit
freely. Unlike building `FROM asb-default`, a copy doesn't pick up later
changes to asb's image. Naming the copy `default` (`asb image new default
--copy default`) replaces the built-in, so `playwright` and your images
built from `asb-default` build on your version.

**A project's own Dockerfile.** Point an image at it instead of copying it:

```yaml
# ~/.config/asb/images/widget/image.yaml
description: the widget project's dev image
context: ~/src/widget
dockerfile: docker/dev.Dockerfile
```

The project's Dockerfile should build `FROM asb-base` (or another asb
image), or create a user from `USERNAME`, `UID`, and `GID` the way
[`images/base/Dockerfile`](images/base/Dockerfile) does.

### Image or home?

An **image** is shared by every sandbox that uses it, changes only when you
rebuild it, and can't be changed from inside a sandbox: put system packages
and tools you want everywhere there. A sandbox's **home** belongs to that
sandbox and persists across containers: per-project tools fit there.
`npm install -g` (the default image sets `NPM_CONFIG_PREFIX` to
`~/.npm-global`), `uv tool install`, and installer scripts that write to
`~/.local/bin` all land in the home, and both directories are on `PATH`.
`uvx <tool>` runs a Python tool (or an MCP server) without installing it,
like `npx`. Ubuntu's system Python refuses `pip install`, even with
`--user`, so use uv, or a virtualenv made with `uv venv`.

## Security model

The isolation boundary is deliberately simple: **the sandbox can read and
write only what you mount, as your uid, with a reduced kernel surface.**

What every container gets:

- **Non-root, your uid/gid**: `--user UID:GID`; created files are owned by
  you. uid and gid 0 are refused (the default if asb itself runs as root).
- **`--security-opt no-new-privileges`**: setuid binaries can't escalate.
- **`--cap-drop ALL`**: drops every Linux capability.
- **`--pids-limit`, `--cpus`, `--memory`**: resource ceilings.
- **`/tmp` is a `noexec,nosuid` tmpfs.**
- **`--rm`**: the container is disposable; state lives only in the mounts.
- **`--mount type=bind`**: a missing source is an error, instead of a root
  owned directory created by `-v`.
- **Ports on 127.0.0.1** unless you give an address.
- Optional read-only root filesystem (`readonly: true`) and
  `network: none`.

### Mount checks

Before a container starts, asb refuses mounts that would let a sandbox
change the host's own files or its own settings:

- A writable mount (the home, the workspace, or a mount without
  `readonly`) may not be or contain your home directory, asb's config
  directory, or asb's data directory, nor be inside asb's files (other than
  the sandbox homes). `workspace: "~"` is refused, for example: the sandbox
  could edit its own file in `~/.config/asb` to mount `/` or add
  `--privileged`.
- No mount source may be reached through a symlink inside any sandbox's
  writable mounts. If one sandbox's workspace contains a directory another
  sandbox mounts, the first could replace it with a link to `~`.
- `asb build` warns when an image's build context is in a sandbox's
  writable mounts (a project's own Dockerfile, say): that sandbox then
  decides what the image contains.

### Protected paths

Anything in a writable mount that the *host* later runs is a way out of the
sandbox. With an mpm workspace mounted, a sandbox could add an alias to
`.mpm/config.yaml`, add a git hook, or set `core.fsmonitor` or
`core.hooksPath` in a repo's `.git/config`, which then runs the next time
you, your shell prompt, or `mpm status` run git there. So these workspace
paths are mounted read-only by default:

```yaml
protect:              # relative to the workspace; * matches one name
  - .mpm
  - .git              # only a .git *file*: worktrees, submodule checkouts
  - .git/config
  - .git/hooks
  - .git/modules/*/config
  - .git/modules/*/hooks
  - '*/.git'
  - '*/.git/config'
  - '*/.git/hooks'
  - '*/.git/modules/*/config'
  - '*/.git/modules/*/hooks'
```

A read-only `.git/config` makes git commands that write config fail in the
sandbox; see [Git in a sandbox](#git-in-a-sandbox). Set your own
`protect` list, for example `protect: [.mpm]`, to loosen this for trusted
agents. Paths are found when the container starts, so repos cloned later
are not covered until a restart. A protected path that is a symlink, or a
protected file with another hard link, stops the start, since a read-only
mount can't cover it. `asb show` lists what is protected.

### Git in a sandbox

Git saves config by writing `.git/config.lock` and renaming it over
`.git/config`, which a read-only mount refuses. So in a sandbox these
fail, because they write a repo's config:

- creating a branch from a remote branch, which sets up tracking:
  `git worktree add -b NEW PATH origin/main`, `git checkout -b NEW
  origin/x`, and `git switch x` when it creates `x` from `origin/x`;
- `git push -u` and `git branch -u`;
- `git remote add` and `set-url`, `git submodule init` (and
  `update --init`), and `git config` without `--global`.

Worktrees from a local branch or HEAD, commits, fetch, plain pushes,
`worktree remove`, and `worktree prune` don't write config, and work.

**Avoid the writes.** Settings in the sandbox's own `~/.gitconfig` (in its
home, so they only affect that sandbox) stop branches from recording
tracking, and let a plain `git push` work without an upstream:

```sh
asb sh widget
git config --global branch.autoSetupMerge false
git config --global push.default current
```

Push with `git push`, or `git push origin BRANCH`, instead of `-u`. For a
one-off, `git worktree add --no-track` does the same.

**Worktree paths.** Git links a worktree to its repo with absolute paths:
the worktree's `.git` file says `gitdir: /path/to/repo/.git/worktrees/NAME`,
and the repo's `.git/worktrees/NAME/gitdir` points back. The workspace is
`/home/agent/workspace` in the container and somewhere else on the host, so
a worktree made on one side is broken on the other (`git status` fails in
it, and `git worktree list` marks it prunable). Worktrees made in a sandbox
also show up in `asb audit` as `.git` files pointing outside the mounts.

**Use relative worktrees** (git 2.48 or later on the host and in the
image). Git records a repo that uses them with `extensions.relativeWorktrees`
in its `.git/config`, which a sandbox can't write, so set it on the host
once per repo:

```sh
git -C ~/src/widget config core.repositoryFormatVersion 1
git -C ~/src/widget config extensions.relativeWorktrees true
```

Or set `git config --global worktree.useRelativePaths true` on the host:
your next `git worktree add` in a repo sets the extension there, and
worktrees you make on the host work in the container too. Either way, then
in the sandbox:

```sh
git config --global worktree.useRelativePaths true
```

Without the extension already set, `git worktree add` in the sandbox then
fails with "unable to upgrade repository format". To relink existing
worktrees, run `git worktree repair --relative-paths` in the repo, naming
the paths of worktrees made on the other side (`git worktree repair
--relative-paths ~/src/widget/.claude/worktrees/fix`).

Some things to know:

- Git older than 2.48 refuses a repo with the extension set, including the
  git bundled with some IDEs and GUIs, and Ubuntu 24.04's (2.43). Images
  not built from asb's `base` need git 2.48 or later too.
- Only worktrees inside the workspace or a mount can work on both sides.

**Or loosen protection** for a trusted sandbox: a `protect` list without
`.git/config` and `*/.git/config` lets git in the sandbox write config. It
also lets the sandbox set `core.fsmonitor` and the like, which would run on
the host before the next [audit](#audit) notices.

### Audit

Read-only mounts only cover files that already exist. A sandbox can still
**create** files the host would act on: a `.git/commondir` that points git
at a config it wrote, a `.git` file naming another git directory, a new repo
with hooks, or an `.envrc`. `asb audit` looks for these in a sandbox's
writable workspace and mounts:

- git directories using `commondir` (outside `.git/worktrees`), and `.git`
  files whose git directory is outside the mounts;
- git config settings that run commands: `core.fsmonitor`,
  `core.hooksPath`, `core.sshCommand`, pagers and editors, `!` aliases,
  filters, diff and merge drivers, credential helpers, includes, and more;
- executable git hooks;
- changes to `.envrc`, `.npmrc`, `.yarnrc.yml`, `.vscode/tasks.json`,
  `.vscode/settings.json`, and `.mpm/config.yaml`.

It looks five directory levels deep (skipping `node_modules`). Findings are
compared with a baseline kept in asb's data directory, so setups you have
reviewed (your own hooks, git-lfs filters) aren't reported again. The first
`asb start` saves a baseline; after that, `start`, `stop`, and `run` print
anything new or changed. Review it before running git or other tools there
on the host, then accept it:

```sh
asb audit widget           # new and changed findings; exits 1 if any
asb audit widget --all     # everything found
asb audit widget --accept  # save the current state as the baseline
```

### Limitations

This is a container, not a VM, and the checks above reduce risk rather
than remove it. Keep mounts scoped to exactly what a sandbox should touch,
and don't add `--privileged` or capabilities with `runArgs` unless you need
them.

- **Kernel exploits** escape containers. There is no user namespace
  remapping: the container's uid is your uid. Rootless Docker (or
  `userns-remap`) limits the damage.
- **The network.** The default `bridge` network can reach services on your
  host (through the bridge gateway, or `host.docker.internal` on Docker
  Desktop), your LAN, other sandboxes on the same network, and cloud
  metadata endpoints (`169.254.169.254`, which can hand out instance
  credentials). Use `network: none` when a sandbox doesn't need the
  network, or a custom network with an egress firewall or proxy (built-in
  allowlists are planned, see [PLAN.md](PLAN.md)).
- **`/tmp` noexec** only stops running files directly; `bash /tmp/x`
  works, and the home and workspace allow running files anyway.
- **Files host tools run** go beyond what the audit checks: Makefiles,
  `package.json` scripts, and test configs all run when you use them on
  the host. Protected paths only reach repos one directory below the
  workspace, and `*` skips names starting with `.`; the audit looks deeper.
- **Races.** A sandbox running when another container starts (an
  `asb run` next to a running sandbox, or two sandboxes sharing a
  workspace) could swap a path between asb's checks and docker mounting
  it.
- **Images** come from the network when built: Ubuntu, uv, and Playwright
  by version tag rather than digest, Node.js from NodeSource's install
  script, and the GitHub CLI from its apt repository. The build caches are
  shared by all image builds, so only build Dockerfiles you trust.

## Shell completion

Completes commands, options, sandbox and image names, and config keys:

```sh
eval "$(asb completion bash)"                         # in ~/.bashrc
source <(asb completion zsh)                          # in ~/.zshrc, after compinit
asb completion fish > ~/.config/fish/completions/asb.fish
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | A docker command failed (`sh` and `run` return the command's own code), or `audit` found new or changed things |
| 2 | Usage or config error |
| 128 + n | The command was killed by signal n (130 for Ctrl-C) |

## Development

```sh
npm test        # vitest; uses a fake docker, so Docker is not needed
npm run lint    # eslint (@digitalbazaar/eslint-config)
```

## License

BSD 3-Clause. See [LICENSE.md](LICENSE.md).
