/**
 * Helpers shared by commands.
 */
import {ConfigError, ExecError, UsageError} from '../errors.js';
import {isDirectory, pathExists} from '../util/fs.js';
import {displayPath} from '../config/paths.js';
import {expandProtect} from '../sandbox/protect.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {spawnAttached} from '../util/spawn.js';

/**
 * Collect repeated option values into an array.
 *
 * @param {string} value - Value.
 * @param {string[]} [previous] - Earlier values.
 *
 * @returns {string[]} Values.
 */
export function collect(value, previous = []) {
  return [...previous, value];
}

/**
 * Check a sandbox's host paths before starting a container, creating the
 * default home directory if needed, and expand its protected paths.
 *
 * @param {object} context - Command context.
 * @param {import('../sandbox/resolve.js').Sandbox} sandbox - Sandbox.
 *
 * @returns {Promise<string[]>} Protected paths, relative to the workspace.
 */
export async function prepareMounts(context, sandbox) {
  const {dryRun, env, notice} = context;
  const show = file => displayPath(file, env);
  if(!await isDirectory(sandbox.home)) {
    if(!sandbox.defaultHome) {
      throw new ConfigError(`Home directory of sandbox "${sandbox.name}" ` +
        `does not exist: ${show(sandbox.home)}`);
    }
    if(dryRun) {
      notice(`would create home directory ${show(sandbox.home)}`);
    } else {
      await fs.mkdir(sandbox.home, {recursive: true, mode: 0o700});
      notice(`created home directory ${show(sandbox.home)}`);
    }
  }
  if(sandbox.workspace && !await isDirectory(sandbox.workspace)) {
    throw new ConfigError(`Workspace of sandbox "${sandbox.name}" does not ` +
      `exist: ${show(sandbox.workspace)}`);
  }
  for(const mount of sandbox.mounts) {
    if(!await pathExists(mount.source)) {
      throw new ConfigError(`Mount source of sandbox "${sandbox.name}" ` +
        `does not exist: ${show(mount.source)}`);
    }
  }
  if(!sandbox.workspace) {
    return [];
  }
  const {paths, symlinks} = await expandProtect(sandbox.workspace,
    sandbox.protect);
  for(const link of symlinks) {
    notice(`not protected (a symlink): ${link}`);
  }
  return paths;
}

/**
 * Check whether a sandbox's container is running. Assumed not running in
 * dry run mode, so commands can be previewed without docker.
 *
 * @param {object} context - Command context.
 * @param {import('../sandbox/resolve.js').Sandbox} sandbox - Sandbox.
 *
 * @returns {Promise<boolean>} True if running.
 */
export async function isRunning(context, sandbox) {
  if(context.dryRun) {
    return false;
  }
  const result = await context.docker.query(['ps', '--quiet', '--filter',
    nameFilter(sandbox.container)]);
  return result.code === 0 && result.stdout.trim() !== '';
}

/**
 * A `docker ps` filter matching exactly one container name. Docker treats
 * the value as a regular expression, and sandbox names may contain ".".
 *
 * @param {string} container - Container name.
 * @param {string} [suffix] - Regular expression for an optional suffix.
 *
 * @returns {string} Filter, e.g. `name=^asb-a\.b$`.
 */
export function nameFilter(container, suffix = '') {
  return `name=^${escapeRegExp(container)}${suffix}$`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Wait until a stopped `--rm` container is gone. Docker removes it shortly
 * after `docker stop` returns, and starting a container with the same name
 * before then fails. Skipped in dry run mode.
 *
 * @param {object} context - Command context.
 * @param {import('../sandbox/resolve.js').Sandbox} sandbox - Sandbox.
 * @param {object} [options] - Options.
 * @param {number} [options.timeout] - Milliseconds to wait.
 */
export async function waitRemoved(context, sandbox, {timeout = 15000} = {}) {
  if(context.dryRun) {
    return;
  }
  const deadline = Date.now() + timeout;
  for(;;) {
    const result = await context.docker.query(['ps', '--all', '--quiet',
      '--filter', nameFilter(sandbox.container)]);
    if(result.code !== 0 || result.stdout.trim() === '') {
      return;
    }
    if(Date.now() > deadline) {
      throw new ExecError(`Container ${sandbox.container} was stopped but ` +
        `not removed after ${timeout / 1000}s; remove it with: ` +
        `docker rm -f ${sandbox.container}`);
    }
    await sleep(200);
  }
}

/**
 * Fail unless a sandbox's container is running (skipped in dry run mode).
 *
 * @param {object} context - Command context.
 * @param {import('../sandbox/resolve.js').Sandbox} sandbox - Sandbox.
 */
export async function requireRunning(context, sandbox) {
  if(!context.dryRun && !await isRunning(context, sandbox)) {
    throw new UsageError(`Sandbox "${sandbox.name}" is not running ` +
      `(start it with: asb start ${sandbox.name}).`);
  }
}

/**
 * Whether to ask docker for a TTY: only when both stdin and the output are
 * terminals.
 *
 * @param {object} context - Command context.
 *
 * @returns {boolean} True for a TTY.
 */
export function useTty(context) {
  return Boolean(process.stdin.isTTY && context.io.stdout.isTTY);
}

/**
 * Open a file in `$VISUAL` or `$EDITOR` (default: vi). In dry run mode,
 * only report what would run.
 *
 * @param {object} context - Command context.
 * @param {string} file - File.
 * @param {object} [options] - Options.
 * @param {string} [options.template] - Content for a new file.
 *
 * @returns {Promise<boolean>} True if the editor ran.
 */
export async function openInEditor(context, file, {template} = {}) {
  const {dryRun, env, io, notice} = context;
  const editor = env.VISUAL || env.EDITOR || 'vi';
  if(dryRun) {
    notice(`would run: ${editor} ${displayPath(file, env)}`);
    return false;
  }
  if(template !== undefined && !await pathExists(file)) {
    await fs.mkdir(path.dirname(file), {recursive: true});
    await fs.writeFile(file, template);
  }
  // the editor command may include arguments, e.g. "code --wait"
  const code = await spawnAttached('sh', ['-c', `${editor} "$1"`,
    'asb-edit', file], {io, env});
  if(code !== 0) {
    throw new UsageError(`Editor exited with code ${code}.`);
  }
  return true;
}

/**
 * The image names to act on: the given names, else the current sandbox's
 * image, else "default" when there is no current sandbox.
 *
 * @param {object} context - Command context.
 * @param {string[]} names - Names given on the command line.
 *
 * @returns {Promise<string[]>} Image names.
 */
export async function imageNames(context, names) {
  if(names.length > 0) {
    return names;
  }
  try {
    return [(await context.sandbox()).image.name];
  } catch(e) {
    // no current sandbox; a bad -s or ASB_SANDBOX, or a directory in more
    // than one sandbox, is an error
    if(e.code !== 'NO_SANDBOX') {
      throw e;
    }
    return ['default'];
  }
}
