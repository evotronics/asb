/**
 * Running git on the host.
 */
import {ExecError} from '../errors.js';
import {spawnCaptured} from './spawn.js';

// the first git that can link worktrees with relative paths
export const RELATIVE_WORKTREES_GIT = [2, 48];

/**
 * Get git's version.
 *
 * @param {string} git - Git command.
 * @param {object} env - Environment.
 *
 * @returns {Promise<{text: string, parts: number[]}>} Version, e.g.
 *   `2.51.0` and `[2, 51, 0]`. Rejects with an ExecError if git is missing
 *   or its version can't be read.
 */
export async function gitVersion(git, env) {
  const result = await spawnCaptured(git, ['--version'], {env});
  const match = result.stdout.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if(result.code !== 0 || !match) {
    throw new ExecError(`Unable to read the version of ${git}.`);
  }
  return {text: match[0], parts: match.slice(1).map(n => Number(n ?? 0))};
}

/**
 * Check a version against a minimum.
 *
 * @param {number[]} parts - Version parts.
 * @param {number[]} minimum - Minimum version parts.
 *
 * @returns {boolean} True if `parts` is at least `minimum`.
 */
export function versionAtLeast(parts, minimum) {
  for(const [i, wanted] of minimum.entries()) {
    const part = parts[i] ?? 0;
    if(part !== wanted) {
      return part > wanted;
    }
  }
  return true;
}

/**
 * Read git config entries with git, which only parses them: with
 * `--no-includes` it reads no other files and runs nothing.
 *
 * @param {string} git - Git command.
 * @param {string[]} source - Where to read, e.g. `['--file', file]` or
 *   `['--global']`.
 * @param {object} env - Environment.
 *
 * @returns {Promise<{code: number, entries: Array<{key: string,
 *   value: string}>}>} Git's exit code and the entries, with lowercase
 *   keys. Rejects with an ExecError if git is missing.
 */
export async function readGitConfig(git, source, env) {
  const result = await spawnCaptured(git, ['config', ...source,
    '--no-includes', '--list', '--null'], {env});
  if(result.code !== 0) {
    return {code: result.code, entries: []};
  }
  return {code: 0, entries: result.stdout.split('\0').filter(Boolean)
    .map(entry => {
      const newline = entry.indexOf('\n');
      return newline === -1 ? {key: entry.toLowerCase(), value: ''} : {
        key: entry.slice(0, newline).toLowerCase(),
        value: entry.slice(newline + 1)
      };
    })};
}
