/**
 * Choose the sandbox a command acts on.
 */
import {getSandbox, resolveAll} from './resolve.js';
import {isInside, realpathOrSelf} from '../util/fs.js';
import path from 'node:path';
import {sandboxMounts} from './check.js';
import {UsageError} from '../errors.js';

/**
 * Choose the current sandbox: an explicit name, then `$ASB_SANDBOX`, then
 * the sandbox whose workspace, home, or mount source contains the current
 * directory (the deepest match wins).
 *
 * @param {import('../config/load.js').Config} config - Config.
 * @param {object} options - Options.
 * @param {string} [options.name] - Name given on the command line.
 * @param {string} options.cwd - Current directory.
 * @param {object} [options.env] - Environment.
 *
 * @returns {Promise<import('./resolve.js').Sandbox>} Sandbox.
 */
export async function selectSandbox(config, {name, cwd, env = config.env}) {
  name ||= env.ASB_SANDBOX;
  if(name) {
    return getSandbox(config, name);
  }
  const found = await findSandboxForPath(config, cwd);
  if(found.length === 1) {
    return found[0];
  }
  if(found.length > 1) {
    throw new UsageError('The current directory is in more than one ' +
      `sandbox: ${found.map(s => s.name).join(', ')}. Choose one with ` +
      '-s <name>.');
  }
  const names = config.sandboxes.map(s => s.name);
  throw new UsageError('No sandbox given, and the current directory is not ' +
    'in one. Choose one with -s <name> or ASB_SANDBOX.', {
    code: 'NO_SANDBOX',
    details: names.length > 0 ? [`Sandboxes: ${names.join(', ')}`] :
      ['Create one with: asb new <name>']
  });
}

/**
 * Find the sandboxes with the deepest host directory (workspace, home, or
 * mount source) containing a path.
 *
 * @param {import('../config/load.js').Config} config - Config.
 * @param {string} dir - Host path.
 *
 * @returns {Promise<import('./resolve.js').Sandbox[]>} Matches (more than
 *   one if they share that directory).
 */
export async function findSandboxForPath(config, dir) {
  const real = await realpathOrSelf(path.resolve(dir));
  let best = [];
  let bestLength = -1;
  // a broken sandbox shouldn't stop others from being found; using it by
  // name reports the error
  for(const {sandbox} of resolveAll(config).filter(r => r.sandbox)) {
    let length = -1;
    for(const {source} of sandboxMounts(sandbox)) {
      const realRoot = await realpathOrSelf(source);
      if(isInside(real, realRoot)) {
        length = Math.max(length, realRoot.length);
      }
    }
    if(length > bestLength) {
      best = [sandbox];
      bestLength = length;
    } else if(length === bestLength && length >= 0) {
      best.push(sandbox);
    }
  }
  return best;
}

/**
 * Map a host path inside a sandbox's workspace or mounts to the matching
 * container path.
 *
 * @param {import('./resolve.js').Sandbox} sandbox - Sandbox.
 * @param {string} dir - Host path.
 *
 * @returns {Promise<string|undefined>} Container path, if mapped.
 */
export async function containerPathFor(sandbox, dir) {
  const real = await realpathOrSelf(path.resolve(dir));
  // the home last, so a mount of the same directory wins
  const [home, ...mounts] = sandboxMounts(sandbox);
  let best;
  for(const {source, target} of [...mounts, home]) {
    const realSource = await realpathOrSelf(source);
    if(isInside(real, realSource) &&
      (!best || realSource.length > best.length)) {
      const rest = path.relative(realSource, real);
      best = {
        length: realSource.length,
        path: rest ? path.posix.join(target, ...rest.split(path.sep)) : target
      };
    }
  }
  return best?.path;
}
