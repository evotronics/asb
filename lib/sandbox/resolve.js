/**
 * Resolve a sandbox definition: apply defaults and expand paths.
 */
import {containerPath, dataDir, hostPath} from '../config/paths.js';
import {ConfigError} from '../errors.js';
import path from 'node:path';

// git config can point core.hooksPath or core.fsmonitor at anything, so
// protecting hooks alone is not enough
export const DEFAULT_PROTECT = Object.freeze([
  '.mpm',
  '.git/config', '.git/hooks',
  '*/.git/config', '*/.git/hooks'
]);

export const DEFAULT_RESOURCES = Object.freeze(
  {cpus: 4, memory: '16g', pids: 2048});

export const CONTAINER_PREFIX = 'asb-';
export const LABEL = 'asb.sandbox';

// objects that merge key by key with defaults; everything else replaces
const MERGED = ['resources', 'env'];

/**
 * @typedef {object} Mount
 * @property {string} source - Host path.
 * @property {string} target - Container path.
 * @property {boolean} readonly - Read-only.
 */

/**
 * @typedef {object} Sandbox
 * @property {string} name - Sandbox name.
 * @property {string} file - Sandbox config file.
 * @property {string} container - Container name.
 * @property {string} [description] - Description.
 * @property {import('../config/load.js').Image} image - Image.
 * @property {string} user - Container user name.
 * @property {number} uid - Container uid.
 * @property {number} gid - Container gid.
 * @property {string} containerHome - Container home directory.
 * @property {string} home - Host home directory.
 * @property {boolean} defaultHome - True if `home` is the default location
 *   (created on demand).
 * @property {string} [workspace] - Host workspace directory.
 * @property {string} workspaceTarget - Container workspace directory.
 * @property {string} workdir - Container working directory.
 * @property {Mount[]} mounts - Extra mounts.
 * @property {string[]} protect - Protected workspace path patterns.
 * @property {string[]} ports - Docker `-p` values.
 * @property {string} network - Docker network.
 * @property {{cpus: (number|string), memory: (number|string),
 *   pids: number}} resources - Limits.
 * @property {{[name: string]: string}} env - Container environment.
 * @property {boolean} readonly - Read-only root filesystem.
 * @property {boolean} tmpExec - Allow exec on /tmp.
 * @property {string} shell - Shell for `asb sh`.
 * @property {string[]} runArgs - Extra `docker run` args.
 * @property {string} docker - Docker command.
 */

/**
 * Find and resolve a sandbox by name.
 *
 * @param {import('../config/load.js').Config} config - Config.
 * @param {string} name - Sandbox name.
 *
 * @returns {Sandbox} Sandbox.
 */
export function getSandbox(config, name) {
  return resolveSandbox(config, findSandboxEntry(config, name));
}

/**
 * Find a sandbox's file without resolving it, so commands that only need
 * its name or file (rm, stop, status) work on a sandbox whose settings
 * are broken.
 *
 * @param {import('../config/load.js').Config} config - Config.
 * @param {string} name - Sandbox name.
 *
 * @returns {{name: string, file: string, data: object}} Sandbox entry.
 */
export function findSandboxEntry(config, name) {
  const entry = config.sandboxes.find(s => s.name === name);
  if(!entry) {
    const names = config.sandboxes.map(s => s.name);
    throw new ConfigError(`Unknown sandbox "${name}".`, {
      details: names.length > 0 ? [`Sandboxes: ${names.join(', ')}`] :
        ['Create one with: asb new <name>']
    });
  }
  return entry;
}

/**
 * The container name of a sandbox.
 *
 * @param {string} name - Sandbox name.
 *
 * @returns {string} Container name.
 */
export function containerName(name) {
  return CONTAINER_PREFIX + name;
}

/**
 * Resolve a sandbox entry.
 *
 * @param {import('../config/load.js').Config} config - Config.
 * @param {{name: string, file: string, data: object}} entry - Sandbox file.
 *
 * @returns {Sandbox} Sandbox.
 */
export function resolveSandbox(config, {name, file, data}) {
  const {env, settings} = config;
  const merged = mergeDefaults(config.defaults, data);
  const where = key => `sandbox "${name}" ${key}`;
  const containerHome = `/home/${settings.user}`;
  const workspaceTarget = `${containerHome}/workspace`;

  const imageName = merged.image ?? 'default';
  const image = config.images[imageName];
  if(!image) {
    throw new ConfigError(`${where('image')}: unknown image ` +
      `"${imageName}".`, {
      details: [`Images: ${Object.keys(config.images).join(', ')}`]
    });
  }

  const home = merged.home === undefined ?
    path.join(dataDir(env), 'homes', name) :
    hostPath(merged.home, {env, where: where('home')});
  const workspace = merged.workspace === undefined ? undefined :
    hostPath(merged.workspace, {env, where: where('workspace')});

  const mounts = (merged.mounts ?? []).map((mount, i) => {
    if(typeof mount === 'string') {
      mount = parseMount(mount);
    }
    return {
      source: hostPath(mount.source, {env, where: where(`mounts[${i}]`)}),
      target: containerPath(mount.target, containerHome),
      readonly: Boolean(mount.readonly)
    };
  });

  const targets = new Map([[containerHome, 'home']]);
  if(workspace) {
    targets.set(workspaceTarget, 'workspace');
  }
  for(const [i, mount] of mounts.entries()) {
    if(targets.has(mount.target)) {
      throw new ConfigError(`${where(`mounts[${i}]`)}: target ` +
        `"${mount.target}" is already used by ${targets.get(mount.target)}.`);
    }
    targets.set(mount.target, `mounts[${i}]`);
  }

  return {
    name,
    file,
    container: CONTAINER_PREFIX + name,
    ...(merged.description ? {description: merged.description} : {}),
    image,
    user: settings.user,
    uid: settings.uid,
    gid: settings.gid,
    containerHome,
    home,
    defaultHome: merged.home === undefined,
    ...(workspace ? {workspace} : {}),
    workspaceTarget,
    workdir: merged.workdir === undefined ?
      workspace ? workspaceTarget : containerHome :
      containerPath(merged.workdir, containerHome),
    mounts,
    protect: workspace ? [...merged.protect ?? DEFAULT_PROTECT] : [],
    ports: (merged.ports ?? []).map(normalizePort),
    network: merged.network ?? 'bridge',
    resources: {...DEFAULT_RESOURCES, ...merged.resources},
    env: Object.fromEntries(Object.entries(merged.env ?? {})
      .map(([key, value]) => [key, String(value)])),
    readonly: Boolean(merged.readonly),
    tmpExec: Boolean(merged.tmpExec),
    shell: merged.shell ?? '/bin/bash',
    runArgs: [...merged.runArgs ?? []],
    docker: settings.docker
  };
}

/**
 * Apply sandbox defaults: objects in MERGED merge key by key, everything
 * else is replaced.
 *
 * @param {object} defaults - Defaults.
 * @param {object} data - Sandbox values.
 *
 * @returns {object} Merged values.
 */
export function mergeDefaults(defaults, data) {
  const merged = {...defaults, ...data};
  for(const key of MERGED) {
    if(defaults[key] || data[key]) {
      merged[key] = {...defaults[key], ...data[key]};
    }
  }
  // a description describes one sandbox
  if(data.description === undefined) {
    delete merged.description;
  }
  return merged;
}

/**
 * Parse a `SOURCE:TARGET[:ro|rw]` mount string.
 *
 * @param {string} value - Mount string.
 *
 * @returns {{source: string, target: string, readonly: boolean}} Mount.
 */
export function parseMount(value) {
  const parts = value.split(':');
  let readonly = false;
  if(parts.length === 3) {
    readonly = parts.pop() === 'ro';
  }
  const [source, target] = parts;
  return {source, target, readonly};
}

/**
 * Normalize a port spec for `docker run -p`. A bare port or range would
 * make docker pick a random host port, so publish it on the same host
 * port: `9323` -> `9323:9323`, `9323/udp` -> `9323:9323/udp`. Specs with a
 * host part are used as is.
 *
 * @param {number|string} value - Port spec.
 *
 * @returns {string} Docker port spec.
 */
export function normalizePort(value) {
  const spec = String(value);
  if(spec.includes(':')) {
    return spec;
  }
  const [port] = spec.split('/');
  return `${port}:${spec}`;
}
