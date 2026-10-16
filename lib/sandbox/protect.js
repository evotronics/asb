/**
 * Protected paths: files and directories in the workspace that are mounted
 * read-only, because the host runs them (mpm aliases, git hooks, git config
 * settings such as `core.fsmonitor` and `core.hooksPath`).
 */
import fs from 'node:fs/promises';
import {ifExists} from '../util/fs.js';
import path from 'node:path';

// files below a protected directory checked for hard links
const MAX_FILES = 2000;

/**
 * Expand protect patterns against a directory.
 *
 * - `*` as a whole path segment matches any entry not starting with ".";
 *   other segments match literally.
 * - A pattern ending in `.git` only matches a `.git` *file* (a worktree or
 *   submodule checkout, naming its git directory); protecting a `.git`
 *   directory would make the repo read-only.
 * - Only existing paths are returned.
 *
 * Problems are returned separately, since a read-only mount doesn't
 * protect them: symlinks (a mount can't be put over one), and files with
 * more than one hard link (another name for the file stays writable).
 *
 * @param {string} root - Directory (the host workspace).
 * @param {string[]} patterns - Relative patterns.
 *
 * @returns {Promise<{paths: string[], symlinks: string[],
 *   hardLinks: string[]}>} Relative paths, sorted and without duplicates.
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
  const hardLinks = new Set();
  for(const relative of paths) {
    for(const file of await linkedFiles(root, relative)) {
      hardLinks.add(file);
    }
  }
  return {
    paths: [...paths].sort(),
    symlinks: [...symlinks].sort(),
    hardLinks: [...hardLinks].sort()
  };
}

async function expand(root, prefix, segments) {
  if(segments.length === 0) {
    return [{path: prefix.join('/'), symlink: false}];
  }
  const [segment, ...rest] = segments;
  const dir = path.join(root, ...prefix);
  let names;
  if(segment === '*') {
    // symlinked directories are not followed: the sandbox can't write
    // through a link that points outside its mounts
    names = (await ifExists(fs.readdir(dir, {withFileTypes: true}), []))
      .filter(e => !e.name.startsWith('.') &&
        (rest.length === 0 || e.isDirectory()))
      .map(e => e.name)
      .sort();
  } else {
    names = [segment];
  }
  const matches = [];
  for(const name of names) {
    const stat = await ifExists(fs.lstat(path.join(dir, name)), null);
    if(!stat) {
      continue;
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
    if(rest.length === 0 && name === '.git' && stat.isDirectory()) {
      continue;
    }
    matches.push(...await expand(root, next, rest));
  }
  return matches;
}

// files at or below a path with more than one hard link
async function linkedFiles(root, relative) {
  const found = [];
  let count = 0;
  const visit = async rel => {
    if(++count > MAX_FILES) {
      return;
    }
    const stat = await fs.lstat(path.join(root, rel));
    if(stat.isDirectory()) {
      for(const name of (await fs.readdir(path.join(root, rel))).sort()) {
        await visit(path.join(rel, name));
      }
    } else if(stat.isFile() && stat.nlink > 1) {
      found.push(rel.split(path.sep).join('/'));
    }
  };
  await visit(relative);
  return found;
}
