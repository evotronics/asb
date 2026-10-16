/**
 * Safety checks before a container starts: mounts must not give a sandbox
 * a way to change the host's own files or asb's config, and must not have
 * been redirected by symlinks a sandbox could have planted.
 */
import {configDir, dataDir, displayPath, homeDir} from '../config/paths.js';
import {ifExists, isInside, realpathOrSelf} from '../util/fs.js';
import {ConfigError} from '../errors.js';
import {printable} from '../util/format.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {resolveAll} from './resolve.js';

/**
 * A sandbox's mounts with their container paths and whether each is
 * writable.
 *
 * @param {import('./resolve.js').Sandbox} sandbox - Sandbox.
 *
 * @returns {Array<{what: string, source: string, target: string,
 *   writable: boolean}>} Mounts.
 */
export function sandboxMounts(sandbox) {
  return [
    {what: 'home', source: sandbox.home, target: sandbox.containerHome,
      writable: true},
    ...(sandbox.workspace ? [{what: 'workspace', source: sandbox.workspace,
      target: sandbox.workspaceTarget, writable: true}] : []),
    ...sandbox.mounts.map((m, i) => ({
      what: `mounts[${i}]`, source: m.source, target: m.target,
      writable: !m.readonly
    }))
  ];
}

/**
 * The real paths of every sandbox's writable mounts: places untrusted code
 * may have changed. Sandboxes with broken settings are skipped.
 *
 * @param {import('../config/load.js').Config} config - Config.
 *
 * @returns {Promise<Array<{name: string, path: string}>>} Roots.
 */
export async function writableRoots(config) {
  const roots = [];
  for(const {sandbox} of resolveAll(config).filter(r => r.sandbox)) {
    for(const mount of sandboxMounts(sandbox).filter(m => m.writable)) {
      roots.push(
        {name: sandbox.name, path: await realpathOrSelf(mount.source)});
    }
  }
  return roots;
}

/**
 * Check a sandbox's mounts:
 *
 * - A writable mount must not be, or contain, your home directory or asb's
 *   config or data directory, and must not be inside the config directory
 *   or (except sandbox homes) the data directory: the sandbox could change
 *   its own settings, or files the host runs.
 * - No mount source may be reached through a symlink that is inside any
 *   sandbox's writable mounts: a sandbox could have planted it to get a
 *   host directory mounted.
 *
 * @param {import('../config/load.js').Config} config - Config.
 * @param {import('./resolve.js').Sandbox} sandbox - Sandbox.
 *
 * @returns {Promise<void>} Resolves if the mounts are safe; rejects with a
 *   ConfigError listing the problems.
 */
export async function checkMounts(config, sandbox) {
  const {env} = config;
  // paths can come from directory names a sandbox chose
  const show = file => printable(displayPath(file, env));
  const protectedDirs = [
    {path: await realpathOrSelf(homeDir(env)), what: 'your home directory'},
    {path: await realpathOrSelf(configDir(env)),
      what: 'the asb config directory'},
    {path: await realpathOrSelf(dataDir(env)),
      what: 'the asb data directory'}
  ];
  const homesDir = await realpathOrSelf(path.join(dataDir(env), 'homes'));
  const roots = await writableRoots(config);
  const problems = [];

  for(const mount of sandboxMounts(sandbox)) {
    const real = await realpathOrSelf(mount.source);
    if(mount.writable) {
      for(const dir of protectedDirs) {
        if(isInside(dir.path, real)) {
          problems.push(`${mount.what} ${show(mount.source)} contains ` +
            `${dir.what} (${show(dir.path)}), so the sandbox could change ` +
            'it.');
        }
      }
      const configPath = protectedDirs[1].path;
      const dataPath = protectedDirs[2].path;
      if(isInside(real, configPath) && real !== configPath ||
        isInside(real, dataPath) && real !== dataPath &&
        !isInside(real, homesDir)) {
        problems.push(`${mount.what} ${show(mount.source)} is inside asb's ` +
          'own files, so the sandbox could change them.');
      }
    }
    const link = await plantedSymlink(mount.source, roots);
    if(link) {
      problems.push(`${mount.what} ${show(mount.source)} goes through the ` +
        `symlink ${show(link.path)}, inside sandbox "${link.root.name}"'s ` +
        'writable mounts, which that sandbox could have changed. Use the ' +
        'real path, or remove the symlink.');
    }
  }
  if(problems.length > 0) {
    throw new ConfigError(`Unsafe mounts in sandbox "${sandbox.name}".`,
      {details: problems});
  }
}

/**
 * Find a symlink on the way to a path that sits inside one of the roots.
 *
 * @param {string} file - Absolute path.
 * @param {Array<{name: string, path: string}>} roots - Writable roots.
 *
 * @returns {Promise<{path: string, root: object}|undefined>} The symlink.
 */
async function plantedSymlink(file, roots) {
  const parts = path.resolve(file).split(path.sep).filter(Boolean);
  let current = path.sep;
  for(const part of parts) {
    const next = path.join(current, part);
    const stat = await ifExists(fs.lstat(next), null);
    if(!stat) {
      return undefined;
    }
    if(stat.isSymbolicLink()) {
      // where the link itself lives, with links above it resolved
      const location = path.join(await realpathOrSelf(current), part);
      const root = roots.find(r => isInside(location, r.path));
      if(root) {
        return {path: next, root};
      }
    }
    current = next;
  }
  return undefined;
}

/**
 * Refuse to run containers as root: the sandbox would own the image's root
 * files, and files it creates in mounts would be owned by root on the host.
 * This happens by default when asb itself runs as root, for example with
 * sudo.
 *
 * @param {object} settings - Settings (`uid`, `gid`).
 */
export function checkUser(settings) {
  if(settings.uid === 0 || settings.gid === 0) {
    throw new ConfigError('Sandboxes do not run as root (uid or gid 0). ' +
      'If asb is running as root (e.g. with sudo), run it as your user ' +
      '(add yourself to the docker group), or set non-root uid and gid ' +
      'settings: asb config set uid 1000');
  }
}
