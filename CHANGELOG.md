# asb ChangeLog

## 0.1.0 - TBD

### Changed
- **BREAKING**: Rewrite in JavaScript (Node.js >= 22.12) as an installable
  `asb` command (also installed as `anything-sandbox`). Renamed from "Agent
  Sandbox" to "Anything Sandbox", since it is useful for running any code
  you don't fully trust.
- **BREAKING**: Named sandboxes replace the single container per checkout.
  Each sandbox is a YAML file, `~/.config/asb/sandboxes/NAME.yaml`, with its
  own image, home, workspace, mounts, ports, network, limits, and
  environment. Its container is `asb-NAME`.
- **BREAKING**: YAML config in `~/.config/asb/` (or `$XDG_CONFIG_HOME/asb`,
  or `$ASB_CONFIG_DIR`), validated against JSON Schemas in `schemas/`,
  replaces `asb.conf` and the `ASB_*` environment variables. `config.yaml`
  holds settings (`user`, `uid`, `gid`, `docker`), `defaults` for every
  sandbox, and `images`. Config is kept out of the sandboxes' mounts so a
  sandbox can't change its own settings. Existing `asb.conf` files must be
  converted by hand (see [PLAN.md](PLAN.md#10-migration-from-the-shell-version)).
- **BREAKING**: The default home directory is
  `~/.local/share/asb/homes/NAME` (created on first start) instead of
  `home/` next to the script.
- **BREAKING**: The Dockerfile moved to `images/default/Dockerfile`.
  `rebuild` is now `build --no-cache`.
- **BREAKING**: `config` (print the resolved configuration) is now `show`
  for a sandbox and `config get` for settings.
- Bind mounts use `--mount type=bind`, which fails on a missing source
  instead of creating a root owned directory.
- `run` containers are named `asb-NAME-run-XXXXXX` and can run alongside
  the sandbox's long running container.

### Added
- The current sandbox is chosen with `-s/--sandbox`, `$ASB_SANDBOX`, or the
  current directory: the sandbox whose workspace, home, or mount source
  contains it.
- `sh` and `run` start in the container path of the current directory when
  it is inside the workspace, a mount, or the home.
- Extra `mounts` (read-only or read-write), and `ports`, `env`, and
  `runArgs` as lists instead of word-split strings.
- Protected paths: `.mpm`, `.git/config`, and `.git/hooks` in the workspace
  and in each repo directory in it are mounted read-only by default, so a
  sandbox can't plant mpm aliases, git hooks, or git config settings
  (`core.fsmonitor`, `core.hooksPath`) that the host would later run.
  Configurable with `protect`.
- `new`, `rm`, `ls`, `show` (`--docker` prints the `docker run` command),
  and `edit` commands to manage sandboxes.
- `config get|set|unset|path|validate|edit`. Edits keep comments, are
  validated before writing, and show a diff with `--dry-run`.
  `config get --show-origin` shows where settings come from.
- Named `images` with their own build context, Dockerfile, tag, and build
  args. `build` builds the current sandbox's image by default.
- `settings.docker` to use a Docker compatible CLI such as podman.
- Containers get a `--hostname` of the sandbox name and an `asb.sandbox`
  label.
- `--json` output for `ls`, `show`, and `config get`.
- Shell completion for bash, zsh, and fish (`asb completion <shell>`),
  covering commands, options, sandbox and image names, and config keys.
- Tests (vitest, with a fake docker), linting, and CI.

### Removed
- **BREAKING**: The `asb` bash script, `asb.conf.example`, and the
  `--name` and `--image` options (use sandbox names and `image`).

## Classic shell version

The original `asb` (2026) was a bash script, `asb`, configured with `ASB_*`
environment variables or a sourced `asb.conf` file (`asb.conf.example`), and
ran one container per checkout of the script with `home/` next to it as the
container's HOME. Its commands were `build`, `rebuild`, `start`, `stop`,
`restart`, `sh`, `run`, `status`, `logs`, `config`, and `help`. It was
replaced by this rewrite; the script can be found in git history (commit
`435cc82`).
