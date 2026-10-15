/**
 * Docker argument builders. These are pure functions of a resolved sandbox
 * so the exact commands can be tested and shown with --dry-run.
 */
import {LABEL} from '../sandbox/resolve.js';
import path from 'node:path';

/**
 * Arguments for `docker run`.
 *
 * @param {import('../sandbox/resolve.js').Sandbox} sandbox - Sandbox.
 * @param {object} [options] - Options.
 * @param {boolean} [options.detach] - Start a long running, named
 *   container (`asb start`); otherwise a one-shot (`asb run`).
 * @param {boolean} [options.tty] - Allocate a TTY.
 * @param {string[]} [options.protect] - Expanded protected paths, relative
 *   to the workspace.
 * @param {string} [options.name] - Container name (default: the sandbox's
 *   container name when detached, else none).
 * @param {string} [options.workdir] - Working directory (default: the
 *   sandbox's).
 * @param {string[]} [options.command] - Command and arguments.
 *
 * @returns {string[]} Arguments, not including the docker command.
 */
export function runArgs(sandbox, {
  detach = true, tty = true, protect = [], workdir = sandbox.workdir,
  name = detach ? sandbox.container : undefined, command = []
} = {}) {
  const args = ['run', detach ? '-itd' : tty ? '-it' : '-i', '--rm'];
  if(name) {
    args.push('--name', name);
  }
  args.push('--label', `${LABEL}=${sandbox.name}`,
    '--hostname', sandbox.name);

  // resource limits
  const {cpus, memory, pids} = sandbox.resources;
  args.push('--cpus', String(cpus), '--memory', String(memory),
    '--pids-limit', String(pids));

  // hardening: no privilege escalation, no Linux capabilities, your uid
  args.push('--security-opt', 'no-new-privileges', '--cap-drop', 'ALL',
    '--user', `${sandbox.uid}:${sandbox.gid}`);

  args.push('--network', sandbox.network);
  args.push('--tmpfs', sandbox.tmpExec ? '/tmp:rw' : '/tmp:rw,noexec,nosuid');
  if(sandbox.readonly) {
    args.push('--read-only');
  }

  // bind mounts: the only writable windows onto the host
  args.push('--mount', bindMount(sandbox.home, sandbox.containerHome));
  if(sandbox.workspace) {
    args.push('--mount', bindMount(sandbox.workspace,
      sandbox.workspaceTarget));
    for(const relative of protect) {
      args.push('--mount', bindMount(
        path.join(sandbox.workspace, relative),
        path.posix.join(sandbox.workspaceTarget, relative),
        {readonly: true}));
    }
  }
  for(const mount of sandbox.mounts) {
    args.push('--mount', bindMount(mount.source, mount.target,
      {readonly: mount.readonly}));
  }
  args.push('--workdir', workdir);

  for(const port of sandbox.ports) {
    args.push('--publish', port);
  }

  // HOME is not set from /etc/passwd when running with a numeric --user
  args.push('--env', `HOME=${sandbox.containerHome}`);
  for(const [key, value] of Object.entries(sandbox.env)) {
    args.push('--env', `${key}=${value}`);
  }

  args.push(...sandbox.runArgs, sandbox.image.tag, ...command);
  return args;
}

/**
 * Arguments for `docker exec`.
 *
 * @param {import('../sandbox/resolve.js').Sandbox} sandbox - Sandbox.
 * @param {object} [options] - Options.
 * @param {boolean} [options.tty] - Allocate a TTY.
 * @param {string} [options.workdir] - Working directory.
 * @param {string[]} [options.command] - Command (default: the shell).
 *
 * @returns {string[]} Arguments.
 */
export function execArgs(sandbox, {
  tty = true, workdir = sandbox.workdir, command = []
} = {}) {
  return ['exec', tty ? '-it' : '-i', '--workdir', workdir,
    sandbox.container, ...(command.length > 0 ? command : [sandbox.shell])];
}

/**
 * Arguments for `docker build`.
 *
 * @param {import('../config/load.js').Image} image - Image.
 * @param {object} settings - Settings (`user`, `uid`, `gid`).
 * @param {object} [options] - Options.
 * @param {boolean} [options.noCache] - Pass --no-cache.
 * @param {boolean} [options.pull] - Pass --pull.
 *
 * @returns {string[]} Arguments.
 */
export function buildArgs(image, settings, {noCache, pull} = {}) {
  const buildArgValues = {
    USERNAME: settings.user,
    UID: settings.uid,
    GID: settings.gid,
    ...image.args
  };
  const args = ['build'];
  for(const [key, value] of Object.entries(buildArgValues)) {
    args.push('--build-arg', `${key}=${value}`);
  }
  if(noCache) {
    args.push('--no-cache');
  }
  if(pull) {
    args.push('--pull');
  }
  args.push('--tag', image.tag, '--file', image.dockerfile, image.context);
  return args;
}

/**
 * A `--mount` value for a bind mount. Fields are CSV quoted, so paths may
 * contain commas.
 *
 * @param {string} source - Host path.
 * @param {string} target - Container path.
 * @param {object} [options] - Options.
 * @param {boolean} [options.readonly] - Read-only.
 *
 * @returns {string} Mount spec.
 */
export function bindMount(source, target, {readonly = false} = {}) {
  const fields = ['type=bind', `source=${source}`, `target=${target}`];
  if(readonly) {
    fields.push('readonly');
  }
  return fields.map(csvField).join(',');
}

function csvField(value) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
