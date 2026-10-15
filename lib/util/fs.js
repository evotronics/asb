/**
 * Filesystem helpers.
 */
import fs from 'node:fs/promises';

/**
 * Check whether a path exists (without following a final symlink).
 *
 * @param {string} file - Path.
 *
 * @returns {Promise<boolean>} True if it exists.
 */
export async function pathExists(file) {
  try {
    await fs.lstat(file);
    return true;
  } catch(e) {
    if(e.code === 'ENOENT' || e.code === 'ENOTDIR') {
      return false;
    }
    throw e;
  }
}

/**
 * Check whether a path is a directory (following symlinks).
 *
 * @param {string} dir - Path.
 *
 * @returns {Promise<boolean>} True if it is a directory.
 */
export async function isDirectory(dir) {
  try {
    return (await fs.stat(dir)).isDirectory();
  } catch(e) {
    if(e.code === 'ENOENT' || e.code === 'ENOTDIR') {
      return false;
    }
    throw e;
  }
}

/**
 * Resolve symlinks in a path, or return it unchanged if it does not exist.
 *
 * @param {string} file - Absolute path.
 *
 * @returns {Promise<string>} Real path.
 */
export async function realpathOrSelf(file) {
  try {
    return await fs.realpath(file);
  } catch(e) {
    if(e.code === 'ENOENT' || e.code === 'ENOTDIR') {
      return file;
    }
    throw e;
  }
}
