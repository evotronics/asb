/**
 * Protected paths: files and directories in the workspace that are mounted
 * read-only, because the host runs them (mpm aliases, git hooks, git config
 * settings such as `core.fsmonitor` and `core.hooksPath`).
 */
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Expand protect patterns against a directory. `*` as a whole path segment
 * matches any entry not starting with ".", other segments match literally.
 * Only existing paths are returned. Symlinks can't be protected by a mount,
 * so they are returned separately.
 *
 * @param {string} root - Directory (the host workspace).
 * @param {string[]} patterns - Relative patterns.
 *
 * @returns {Promise<{paths: string[], symlinks: string[]}>} Relative paths,
 *   sorted and without duplicates.
 */
export async function expandProtect(root, patterns) {
  const paths = new Set();
  const symlinks = new Set();
  for(const pattern of patterns) {
    const segments = pattern.split('/').filter(s => s && s !== '.');
    for(const match of await expand(root, [], segments)) {
      (match.symlink ? symlinks : paths).add(match.path);
    }
  }
  return {paths: [...paths].sort(), symlinks: [...symlinks].sort()};
}

async function expand(root, prefix, segments) {
  if(segments.length === 0) {
    return [{path: prefix.join('/'), symlink: false}];
  }
  const [segment, ...rest] = segments;
  const dir = path.join(root, ...prefix);
  let names;
  if(segment === '*') {
    try {
      // symlinked directories are not followed: the sandbox can't write
      // through a link that points outside its mounts
      names = (await fs.readdir(dir, {withFileTypes: true}))
        .filter(e => !e.name.startsWith('.') &&
          (rest.length === 0 || e.isDirectory()))
        .map(e => e.name)
        .sort();
    } catch(e) {
      if(e.code === 'ENOENT' || e.code === 'ENOTDIR') {
        return [];
      }
      throw e;
    }
  } else {
    names = [segment];
  }
  const matches = [];
  for(const name of names) {
    let stat;
    try {
      stat = await fs.lstat(path.join(dir, name));
    } catch(e) {
      if(e.code === 'ENOENT' || e.code === 'ENOTDIR') {
        continue;
      }
      throw e;
    }
    const next = [...prefix, name];
    if(stat.isSymbolicLink()) {
      // a read-only mount can't be put over a symlink
      matches.push({path: next.join('/'), symlink: true});
      continue;
    }
    if(rest.length > 0 && !stat.isDirectory()) {
      continue;
    }
    matches.push(...await expand(root, next, rest));
  }
  return matches;
}
