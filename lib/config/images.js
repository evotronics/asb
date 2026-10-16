/**
 * Images: one directory per image, built in (`<package>/images/NAME/`) or
 * yours (`~/.config/asb/images/NAME/`, which replaces a built-in of the same
 * name). The directory is the build context unless its optional
 * `image.yaml` names another one.
 */
import {configDir, displayPath, homeDir, IMAGE_FILE, IMAGES_DIR,
  NAME_PATTERN, PACKAGE_DIR} from './paths.js';
import {ConfigError} from '../errors.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {readConfigFile} from './files.js';

export const BUILTIN_IMAGES_DIR = path.join(PACKAGE_DIR, IMAGES_DIR);

/**
 * @typedef {object} Image
 * @property {string} name - Image name.
 * @property {'built-in'|'user'} source - Where it is defined.
 * @property {string} dir - Its directory.
 * @property {string} [description] - Description.
 * @property {string} tag - Docker image tag.
 * @property {string} context - Build context directory.
 * @property {string} dockerfile - Dockerfile path.
 * @property {object} args - Extra build args.
 */

/**
 * Load the built-in and user images.
 *
 * @param {object} [options] - Options.
 * @param {object} [options.env] - Environment.
 * @param {Map<string, string|null>} [options.overrides] - Pending file
 *   contents by absolute path.
 * @param {string} [options.builtinDir] - Built-in images directory.
 *
 * @returns {Promise<{[name: string]: Image}>} Images by name, sorted.
 */
export async function loadImages({
  env = process.env, overrides = new Map(), builtinDir = BUILTIN_IMAGES_DIR
} = {}) {
  const images = {};
  const sources = [
    ['built-in', builtinDir],
    ['user', path.join(configDir(env), IMAGES_DIR)]
  ];
  for(const [source, dir] of sources) {
    for(const name of await listImageDirs(dir, {env})) {
      images[name] = await loadImage(path.join(dir, name),
        {name, source, env, overrides});
    }
  }
  return Object.fromEntries(Object.entries(images)
    .sort(([a], [b]) => a.localeCompare(b)));
}

async function listImageDirs(dir, {env}) {
  let entries;
  try {
    entries = await fs.readdir(dir, {withFileTypes: true});
  } catch(e) {
    if(e.code === 'ENOENT') {
      return [];
    }
    throw e;
  }
  const names = [];
  for(const entry of entries) {
    if(entry.name.startsWith('.')) {
      continue;
    }
    const full = path.join(dir, entry.name);
    // follow symlinks, so an image directory can live elsewhere
    const stat = await fs.stat(full).catch(() => null);
    if(!stat?.isDirectory()) {
      continue;
    }
    if(!NAME_PATTERN.test(entry.name)) {
      throw new ConfigError(`Invalid image directory name ` +
        `"${displayPath(full, env)}": names must be lowercase letters, ` +
        'digits, ".", "_", or "-", starting with a letter or digit.');
    }
    names.push(entry.name);
  }
  return names;
}

async function loadImage(dir, {name, source, env, overrides}) {
  const data = await readConfigFile(path.join(dir, IMAGE_FILE),
    {kind: 'image', env, overrides}) ?? {};
  const context = data.context === undefined ? dir :
    resolvePath(data.context, dir, env);
  return {
    name,
    source,
    dir,
    ...(data.description ? {description: data.description} : {}),
    tag: data.tag ?? `asb-${name}`,
    context,
    dockerfile: path.resolve(context, data.dockerfile ?? 'Dockerfile'),
    args: data.args ?? {}
  };
}

function resolvePath(value, dir, env) {
  if(value === '~' || value.startsWith('~/')) {
    return path.join(homeDir(env), value.slice(1));
  }
  return path.resolve(dir, value);
}

/**
 * Get an image by name.
 *
 * @param {{[name: string]: Image}} images - Images.
 * @param {string} name - Name.
 *
 * @returns {Image} Image.
 */
export function getImage(images, name) {
  const image = images[name];
  if(!image) {
    throw new ConfigError(`Unknown image "${name}".`, {
      details: [`Images: ${Object.keys(images).join(', ')}`]
    });
  }
  return image;
}

/**
 * Read an image's Dockerfile.
 *
 * @param {Image} image - Image.
 * @param {object} [options] - Options.
 * @param {object} [options.env] - Environment.
 *
 * @returns {Promise<string>} Dockerfile text.
 */
export async function readDockerfile(image, {env = process.env} = {}) {
  try {
    return await fs.readFile(image.dockerfile, 'utf8');
  } catch(e) {
    if(e.code === 'ENOENT' || e.code === 'ENOTDIR') {
      throw new ConfigError(`Image "${image.name}" has no Dockerfile: ` +
        displayPath(image.dockerfile, env));
    }
    throw e;
  }
}

/**
 * Image references in a Dockerfile's FROM lines. `--platform=...` options
 * and `AS stage` names are skipped.
 *
 * @param {string} text - Dockerfile text.
 *
 * @returns {string[]} References, e.g. `asb-default` or `ubuntu:24.04`.
 */
export function fromReferences(text) {
  const refs = [];
  for(const line of text.split('\n')) {
    const match = line.match(/^\s*FROM\s+(.*)$/i);
    if(!match) {
      continue;
    }
    const ref = match[1].trim().split(/\s+/).find(t => !t.startsWith('--'));
    if(ref) {
      refs.push(ref);
    }
  }
  return refs;
}

/**
 * The asb images an image is built from: FROM references that match
 * another image's tag (with or without `:latest`). `FROM ${ARG}` is not
 * detected.
 *
 * @param {Image} image - Image.
 * @param {{[name: string]: Image}} images - All images.
 * @param {object} [options] - Options.
 * @param {object} [options.env] - Environment.
 *
 * @returns {Promise<string[]>} Image names.
 */
export async function imageBases(image, images, {env} = {}) {
  const byTag = new Map();
  for(const other of Object.values(images)) {
    byTag.set(other.tag, other.name);
    if(!other.tag.includes(':')) {
      byTag.set(`${other.tag}:latest`, other.name);
    }
  }
  const bases = [];
  for(const ref of fromReferences(await readDockerfile(image, {env}))) {
    const name = byTag.get(ref);
    if(name && name !== image.name && !bases.includes(name)) {
      bases.push(name);
    }
  }
  return bases;
}

/**
 * The order to build images in: each image's bases before it, each image
 * once.
 *
 * @param {string[]} names - Images to build.
 * @param {{[name: string]: Image}} images - All images.
 * @param {object} [options] - Options.
 * @param {boolean} [options.bases] - Include base images.
 * @param {object} [options.env] - Environment.
 *
 * @returns {Promise<Array<{name: string, baseOf?: string}>>} Build order;
 *   `baseOf` names the image that needed a base image.
 */
export async function buildOrder(names, images, {
  bases = true, env
} = {}) {
  const order = [];
  const done = new Set();
  const visiting = [];
  const visit = async (name, baseOf) => {
    if(done.has(name)) {
      return;
    }
    if(visiting.includes(name)) {
      throw new ConfigError('Images are built from each other: ' +
        [...visiting.slice(visiting.indexOf(name)), name].join(' -> '));
    }
    const image = getImage(images, name);
    visiting.push(name);
    if(bases) {
      for(const base of await imageBases(image, images, {env})) {
        await visit(base, name);
      }
    } else {
      await readDockerfile(image, {env});
    }
    visiting.pop();
    done.add(name);
    order.push(baseOf ? {name, baseOf} : {name});
  };
  for(const name of names) {
    await visit(name);
  }
  return order;
}
