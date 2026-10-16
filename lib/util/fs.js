/**
 * Filesystem helpers.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const MISSING = ['ENOENT', 'ENOTDIR'];

/**
 * Wait for a filesystem operation, returning a fallback if the file is
 * missing.
 *
 * @param {Promise} promise - Operation.
 * @param {*} fallback - Value if it fails with one of `codes`.
 * @param {string[]} [codes] - Error codes meaning the file is missing.
 *
 * @returns {Promise<*>} Result or fallback.
 */
export async function ifExists(promise, fallback, codes = MISSING) {
  try {
    return await promise;
  } catch(e) {
    if(codes.includes(e.code)) {
      return fallback;
    }
    throw e;
  }
}

/**
 * Check whether a path exists (without following a final symlink).
 *
 * @param {string} file - Path.
 *
 * @returns {Promise<boolean>} True if it exists.
 */
export async function pathExists(file) {
  return ifExists(fs.lstat(file).then(() => true), false);
}

/**
 * Check whether a path is a directory (following symlinks).
 *
 * @param {string} dir - Path.
 *
 * @returns {Promise<boolean>} True if it is a directory.
 */
export async function isDirectory(dir) {
  return ifExists(fs.stat(dir).then(stat => stat.isDirectory()), false);
}

/**
 * Resolve symlinks in a path, or return it unchanged if it does not exist.
 *
 * @param {string} file - Absolute path.
 *
 * @returns {Promise<string>} Real path.
 */
export async function realpathOrSelf(file) {
  return ifExists(fs.realpath(file), file);
}

/**
 * Check whether a path is a directory or inside it.
 *
 * @param {string} file - Absolute path.
 * @param {string} dir - Absolute directory path.
 *
 * @returns {boolean} True if `file` is `dir` or inside it.
 */
export function isInside(file, dir) {
  return file === dir || file.startsWith(dir.endsWith(path.sep) ?
    dir : dir + path.sep);
}
