/**
 * Config and data locations, and host / container path expansion.
 */
import {ConfigError} from '../errors.js';
import os from 'node:os';
import path from 'node:path';

export const CONFIG_FILE = 'config.yaml';
export const SANDBOXES_DIR = 'sandboxes';
export const FILE_EXTENSIONS = ['.yaml', '.yml'];
// a sandbox or image name is used in container and image names
export const NAME_PATTERN = /^[a-z0-9][a-z0-9_.-]*$/;

/**
 * The user's home directory.
 *
 * @param {object} [env] - Environment.
 *
 * @returns {string} Absolute path.
 */
export function homeDir(env = process.env) {
  return env.HOME || os.homedir();
}

/**
 * The asb config directory: `$ASB_CONFIG_DIR`, else
 * `$XDG_CONFIG_HOME/asb`, else `~/.config/asb`.
 *
 * @param {object} [env] - Environment.
 *
 * @returns {string} Absolute path (it may not exist).
 */
export function configDir(env = process.env) {
  if(env.ASB_CONFIG_DIR) {
    return path.resolve(env.ASB_CONFIG_DIR);
  }
  const base = env.XDG_CONFIG_HOME || path.join(homeDir(env), '.config');
  return path.join(base, 'asb');
}

/**
 * The asb data directory: `$XDG_DATA_HOME/asb`, else
 * `~/.local/share/asb`. Default sandbox homes live in `homes/` under it.
 *
 * @param {object} [env] - Environment.
 *
 * @returns {string} Absolute path (it may not exist).
 */
export function dataDir(env = process.env) {
  const base = env.XDG_DATA_HOME ||
    path.join(homeDir(env), '.local', 'share');
  return path.join(base, 'asb');
}

/**
 * Expand a host path from config. It must be absolute or start with `~`.
 *
 * @param {string} value - Path from config.
 * @param {object} options - Options.
 * @param {object} [options.env] - Environment.
 * @param {string} options.where - Description for errors.
 *
 * @returns {string} Absolute, normalized path.
 */
export function hostPath(value, {env = process.env, where}) {
  if(value === '~' || value.startsWith('~/')) {
    return path.join(homeDir(env), value.slice(1));
  }
  if(!path.isAbsolute(value)) {
    throw new ConfigError(`${where}: "${value}" must be an absolute path ` +
      'or start with "~/".');
  }
  return path.resolve(value);
}

/**
 * Expand a container path from config: `~` is the container home, and
 * relative paths are relative to it.
 *
 * @param {string} value - Path from config.
 * @param {string} containerHome - Container home directory.
 *
 * @returns {string} Absolute container path.
 */
export function containerPath(value, containerHome) {
  if(value === '~' || value.startsWith('~/')) {
    return path.posix.join(containerHome, value.slice(1));
  }
  return path.posix.resolve(containerHome, value);
}

/**
 * Show a path with the home directory as `~`.
 *
 * @param {string} file - Absolute path.
 * @param {object} [env] - Environment.
 *
 * @returns {string} Display path.
 */
export function displayPath(file, env = process.env) {
  const home = homeDir(env);
  if(file === home) {
    return '~';
  }
  if(file.startsWith(home + path.sep)) {
    return '~' + file.slice(home.length);
  }
  return file;
}
