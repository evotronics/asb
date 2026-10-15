# asb — Anything Sandbox: Rewrite Plan

Status: **v0.1**. Decisions are marked ✅ decided, 🟡 proposed default, or
❓ open question.

## 1. Goals

- Run coding agents, or any code you don't fully trust, in a disposable,
  hardened Docker container. The only writable windows onto the host are
  directories you choose to bind mount.
- Make it easy to keep **many named sandboxes**, each with its own home
  directory, workspace, extra mounts, ports, and limits. A typical workspace
  is an [mpm](https://github.com/evotronics/mpm) workspace with only the few
  repos a project needs, so an agent sees a scoped set of checkouts.
- Structured, validated config that is easy to read and that the tool can
  edit, instead of sourced shell variables.
- Every command that runs docker supports `--dry-run`, printing the exact
  command.

### Non-goals (for now)

- VM level isolation. This is a container: a kernel exploit escapes it.
- Orchestrating multiple containers per sandbox (compose-like). A proxy
  container for network allowlists (§7) is the one planned exception.

## 2. Lessons from the shell version

| Shell behavior | Problem | New design |
|---|---|---|
| `asb.conf` is sourced shell using `${VAR:=...}` | Hard to read; no validation; config can run code | YAML files validated with JSON Schemas; `config get --show-origin` |
| One container per asb checkout (`asb-<dirname>`), `home/` next to the script | A second sandbox means juggling env vars | Named sandboxes, one file each, container `asb-<name>` |
| `ASB_WORKSPACE` is the only extra mount | Can't map several directories | `workspace` plus a `mounts` list |
| `ASB_PORTS` comma string, `ASB_EXTRA_RUN_ARGS` word split | Quoting bugs, hard to extend | YAML lists; `runArgs` is an argv array |
| Config lives next to the script | Fine, but mixed with code | User config dir, `~/.config/asb/` |
| No tests | | Docker argv built by a pure function, unit tested; integration tests with a fake `docker` |

## 3. Technology

✅ Same stack as mpm so the two tools look and work alike:

- JavaScript (Node.js >= 22.12, ESM), plain JS with JSDoc, no build step.
- `commander` for the CLI, wired from a command registry.
- `yaml` (Document API keeps comments when asb edits files), `ajv` for
  JSON Schema validation, `picocolors`, `diff` for dry run config diffs.
- vitest, `@digitalbazaar/eslint-config`, GitHub Actions CI, Keep a
  Changelog style `CHANGELOG.md` with a note on the classic shell version.
- ✅ License: BSD-3-Clause, copyright David I. Lehn (`LICENSE.md`).
- ✅ Name: **asb, Anything Sandbox** (was Agent Sandbox). Package
  `@evotronics/asb`, binary `asb` plus a long alias `anything-sandbox`.

## 4. Core concepts

- **Sandbox**: a named container definition: image, home directory,
  workspace, extra mounts, ports, network, limits, environment. Its
  container is named `asb-<name>` and labeled `asb.sandbox=<name>`.
- **Image**: a named Docker build (context directory, Dockerfile, build
  args), tagged `asb-<image>`. The `default` image ships with asb
  (`images/default/`). Your uid/gid and in-container user name are passed
  as build args.
- **Home**: a host directory mounted as the container's `$HOME`
  (`/home/<user>`). Default: `$XDG_DATA_HOME/asb/homes/<name>`
  (`~/.local/share/asb/homes/<name>`), created on first use.
- **Workspace**: the main host directory, mounted at
  ✅ `/home/<user>/workspace` (fixed for now; mirroring the host path is a
  possible later option).
- **Current sandbox**: chosen by `-s, --sandbox <name>`, then
  `$ASB_SANDBOX`, then by the current directory: if it is inside a
  sandbox's workspace, home, or a mount source, that sandbox is used (the
  deepest match wins; ties are an error).

## 5. Config

✅ All config lives in the **user config directory**, never inside a
sandbox's mounts: `$XDG_CONFIG_HOME/asb/` (default `~/.config/asb/`), or
`$ASB_CONFIG_DIR`. A sandbox can write to everything it mounts, so a config
file inside a mount could be edited by the agent to widen its own access the
next time you run `asb start`.

```
~/.config/asb/
  config.yaml            # settings, defaults for all sandboxes, images
  sandboxes/
    widget.yaml          # one file per sandbox; the file name is its name
    scratch.yaml
```

```yaml
# ~/.config/asb/config.yaml
version: 1
settings:
  user: agent        # in-container user name
  # uid: 1000        # default: yours
  # gid: 1000
  # docker: podman   # docker compatible CLI to run
defaults:            # applied to every sandbox; a sandbox file overrides
  resources: {cpus: 4, memory: 16g, pids: 2048}
images:
  node:
    context: ~/src/my-images/node
    # dockerfile: Dockerfile
    # args: {NODE_MAJOR: "24"}
```

```yaml
# ~/.config/asb/sandboxes/widget.yaml
description: widget work, with only the widget repos checked out
image: default
# home: ~/.local/share/asb/homes/widget    # default
workspace: ~/sandboxes/widget              # -> /home/agent/workspace
mounts:
  - source: ~/src/shared-fixtures
    target: ~/fixtures                      # ~ = the container home
    readonly: true
ports: [5173-5177, 9323]                    # bare ports keep their number
network: bridge                             # bridge | none | <network name>
resources: {memory: 8g}                     # merged with defaults
env: {NODE_ENV: development}
# readonly: true      # read-only root filesystem
# tmpExec: true       # allow executing from /tmp
# runArgs: [--add-host, host.docker.internal:host-gateway]
```

- ✅ Merging: a sandbox's values override `defaults`. Objects
  (`resources`, `env`) merge key by key; lists replace.
- ✅ Paths must be absolute or start with `~` (your home). Container paths
  (`target`) may start with `~`, meaning the container home; relative
  targets are relative to the container home.
- ✅ Environment variables: only `ASB_CONFIG_DIR` and `ASB_SANDBOX`.
  Everything else that was an `ASB_*` variable is now config.
- 🟡 `asb new`, `asb rm`, and `asb config set|unset` edit files keeping
  comments, validate before writing, and show a diff with `-n`.

## 6. Security model

Same baseline as the shell version, by default:

- Runs as your uid/gid (`--user`), so files land owned by you and there is
  no root in the container.
- `--security-opt no-new-privileges`, `--cap-drop ALL`, `--pids-limit`,
  `--cpus`, `--memory`.
- `/tmp` is a `noexec,nosuid` tmpfs (unless `tmpExec`).
- `--rm`: state lives only in the mounts.
- Optional read-only root filesystem and `network: none`.
- Mounts use `--mount type=bind`, which fails on a missing source instead
  of creating a root owned directory like `-v` does.

✅ **Protected paths.** Anything in a writable mount that the *host* later
runs is a way out of the sandbox. With an mpm workspace mounted, the agent
could add an alias to `.mpm/config.yaml`, or a git hook, or set
`core.fsmonitor` / `core.hooksPath` in a repo's `.git/config`, which runs
the next time you (or `mpm status`) run git on the host. asb mounts
**protected paths read-only** over the workspace:

```yaml
protect:              # relative to the workspace; * matches one name
  - .mpm
  - .git/hooks
  - '*/.git/hooks'
  # - '*/.git/config' # stricter; breaks e.g. creating tracking branches
```

The list above is the default. Paths are expanded when the container starts,
so repos cloned later are not covered until a restart. Only existing paths
are mounted.

## 7. CLI

```
asb [global options] <command> [options] [args...]
```

Global options: `-s, --sandbox <name>`, `-n, --dry-run`, `-v, --verbose`,
`--[no-]color`. `--json` on commands that print data (`ls`, `show`,
`config get`).

| Command | Description |
|---|---|
| `new <name>` | Create a sandbox (`--workspace`, `--mount`, `--port`, `--image`, `--home`) |
| `rm <name>` | Remove a sandbox's config (its home is kept) |
| `ls` | Sandboxes with state, image, and workspace |
| `show [name]` | Resolved sandbox settings (`--docker`: the `docker run` command) |
| `edit [name]` | Open the sandbox file in `$VISUAL`/`$EDITOR`, then validate |
| `start [name]` (`up`) | Start the container (detached, `--rm`) |
| `stop [names...]` (`down`) | Stop containers |
| `restart [name]` | Stop then start |
| `sh [cmd...]` (`shell`, `exec`) | Exec into the running container; the working directory follows yours when you are inside the workspace |
| `run <cmd...>` | One-shot throwaway container |
| `status [names...]` (`ps`) | Container state of sandboxes |
| `logs [docker args]` | Container logs |
| `build [images...]` | Build images (`--no-cache`, `--pull`); default: the current sandbox's image, else `default` |
| `config get\|set\|unset\|path\|edit\|validate` | `config.yaml` |
| `completion bash\|zsh\|fish` | Shell completion |

## 8. Architecture

```
bin/asb.js            # thin entry
lib/
  index.js            # library API
  cli/                # commander wiring from the command registry
  commands/           # one module per command: {name, options, run()}
  config/             # paths, YAML files, schema validation, editor
  sandbox/            # resolve (defaults, paths), select (cwd detection)
  docker/             # argv builders (pure), process runner with dry run
images/default/       # the default image's Dockerfile
schemas/              # config and sandbox JSON Schemas
test/                 # vitest: unit tests of argv building; CLI tests with a fake docker
```

## 9. Milestones

1. **Scaffold**: package.json, eslint, vitest, CI, LICENSE, CHANGELOG,
   `bin/asb.js`.
2. **Core**: config loading and validation, sandbox resolution and
   selection, docker argv builders, protected paths.
3. **Commands**: parity with the shell version (`build`, `start`, `stop`,
   `restart`, `sh`, `run`, `status`, `logs`), then `new`, `rm`, `ls`,
   `show`, `edit`, `config`.
4. **Switch over**: remove the shell script, move the Dockerfile to
   `images/default/`, README, CHANGELOG.
5. **Polish**: shell completion; publish `@evotronics/asb`.
6. **Future**:
   - **Network allowlists.** `network: {allow: [github.com,
     registry.npmjs.org]}`: put the container on an `--internal` Docker
     network (no route out) and start a small proxy container attached to
     both that network and the outside, which only forwards to allowed
     hosts; set `HTTP(S)_PROXY` in the sandbox. Unlike in-container
     iptables, the sandbox needs no `NET_ADMIN` capability.
   - **Home setup.** `asb home init <name>`: copy a template directory, or
     run `chezmoi init --apply <repo>` inside the container, to set up a
     new sandbox's dotfiles.
   - **mpm integration.** `asb new widget --mpm <workspace> -r 'widget*'`
     to create a scoped mpm workspace for a sandbox.
   - Mirroring the host workspace path inside the container.
   - Prebuilt (pulled) images without a build context.

## 10. Migration from the shell version

✅ No importer. Map `asb.conf` by hand:

| Shell | New |
|---|---|
| `ASB_HOME` | sandbox `home` |
| `ASB_WORKSPACE` / `ASB_WORKSPACE_TARGET` | `workspace` (target is fixed) / a `mounts` entry for another target |
| `ASB_PORTS=5173-5177,9323` | `ports: [5173-5177, 9323]` |
| `ASB_CPUS` / `ASB_MEMORY` / `ASB_PIDS_LIMIT` | `resources: {cpus, memory, pids}` |
| `ASB_NETWORK` | `network` |
| `ASB_READONLY=1` / `ASB_TMPFS_EXEC=1` | `readonly: true` / `tmpExec: true` |
| `ASB_EXTRA_RUN_ARGS` | `runArgs` (a list) |
| `ASB_SHELL` | `shell` |
| `ASB_USER` / `ASB_UID` / `ASB_GID` | `settings.user` / `uid` / `gid` |
| `ASB_IMAGE` | `image` (an image name from `images`) |
| `ASB_NAME` | the sandbox name (container `asb-<name>`) |
| `rebuild` | `build --no-cache` |
| `config` | `show` (sandbox) and `config get` (settings) |
