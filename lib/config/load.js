/**
 * Load the asb config directory: `config.yaml`, `sandboxes/*.yaml`, and
 * `images/*` (with the built-in images).
 */
import {CONFIG_FILE, configDir, displayPath, FILE_EXTENSIONS, NAME_PATTERN,
  SANDBOXES_DIR} from './paths.js';
import {ConfigError} from '../errors.js';
import fs from 'node:fs/promises';
import {ifExists} from '../util/fs.js';
import {loadImages} from './images.js';
import path from 'node:path';
import {readConfigFile} from './files.js';

/**
 * Built-in setting defaults.
 *
 * @returns {object} Settings.
 */
export function defaultSettings() {
  return {
    user: 'agent',
    uid: process.getuid?.() ?? 1000,
    gid: process.getgid?.() ?? 1000,
    docker: 'docker'
  };
}

/**
 * @typedef {object} Config
 * @property {string} dir - Config directory.
 * @property {string} file - `config.yaml` path.
 * @property {boolean} exists - True if `config.yaml` exists.
 * @property {object} settings - Effective settings.
 * @property {object} settingOrigins - Where each setting came from:
 *   `default` or a display path.
 * @property {object} defaults - Sandbox defaults.
 * @property {{[name: string]: import('./images.js').Image}} images -
 *   Images by name.
 * @property {Array<{name: string, file: string, data: object}>} sandboxes -
 *   Sandbox files, sorted by name.
 * @property {object} env - Environment used for paths.
 */

/**
 * Load the config.
 *
 * @param {object} [options] - Options.
 * @param {object} [options.env] - Environment.
 * @param {Map<string, string|null>} [options.overrides] - Pending file
 *   contents by absolute path; null means deleted. Used to validate edits
 *   before writing them.
 *
 * @returns {Promise<Config>} Config.
 */
export async function loadConfig({
  env = process.env, overrides = new Map()
} = {}) {
  const dir = configDir(env);
  const file = path.join(dir, CONFIG_FILE);
  const data = await readConfigFile(file, {kind: 'config', env, overrides});
  const exists = data !== undefined;
  const config = data ?? {};

  const settings = defaultSettings();
  const settingOrigins = Object.fromEntries(
    Object.keys(settings).map(key => [key, 'default']));
  for(const [key, value] of Object.entries(config.settings ?? {})) {
    settings[key] = value;
    settingOrigins[key] = displayPath(file, env);
  }

  const images = await loadImages({env, overrides});

  const sandboxes = [];
  for(const {name, file: sandboxFile} of
    await listSandboxFiles(path.join(dir, SANDBOXES_DIR), {overrides})) {
    if(!NAME_PATTERN.test(name)) {
      throw new ConfigError(`Invalid sandbox file name ` +
        `"${displayPath(sandboxFile, env)}": names must be lowercase ` +
        'letters, digits, ".", "_", or "-", starting with a letter or digit.');
    }
    const sandbox = await readConfigFile(sandboxFile,
      {kind: 'sandbox', env, overrides});
    sandboxes.push({name, file: sandboxFile, data: sandbox ?? {}});
  }

  return {
    dir,
    file,
    exists,
    settings,
    settingOrigins,
    defaults: config.defaults ?? {},
    images,
    sandboxes,
    env
  };
}

/**
 * List sandbox files, sorted by name.
 *
 * @param {string} dir - Sandboxes directory.
 * @param {object} [options] - Options.
 * @param {Map<string, string|null>} [options.overrides] - Pending file
 *   contents; new files in `dir` are included, null ones excluded.
 *
 * @returns {Promise<Array<{name: string, file: string}>>} Files.
 */
export async function listSandboxFiles(dir, {overrides = new Map()} = {}) {
  const entries = await ifExists(
    fs.readdir(dir, {withFileTypes: true}), [], ['ENOENT']);
  const files = new Set(entries.filter(e => e.isFile())
    .map(e => path.join(dir, e.name)));
  for(const [file, text] of overrides) {
    if(path.dirname(file) !== dir) {
      continue;
    }
    if(text === null) {
      files.delete(file);
    } else {
      files.add(file);
    }
  }
  const result = [];
  for(const file of files) {
    const base = path.basename(file);
    const extension = path.extname(base);
    if(!FILE_EXTENSIONS.includes(extension) || base.startsWith('.')) {
      continue;
    }
    result.push({name: path.basename(base, extension), file});
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}
