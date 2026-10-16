/**
 * `asb image ls|new|show`: images.
 */
import {buildOrder, getImage, imageBases} from '../config/images.js';
import {configDir, displayPath, IMAGE_FILE, IMAGES_DIR, NAME_PATTERN}
  from '../config/paths.js';
import {ConfigError, ExecError, UsageError} from '../errors.js';
import {formatTable} from '../util/format.js';
import fs from 'node:fs/promises';
import {imageNames} from './common.js';
import path from 'node:path';
import {pathExists} from '../util/fs.js';
import YAML from 'yaml';

/**
 * Tags of the images docker has, from `docker image ls`.
 *
 * @param {object} docker - Runner from `createDocker`.
 *
 * @returns {Promise<Set<string>>} `repository:tag` values.
 */
async function builtTags(docker) {
  const result = await docker.query(['image', 'ls', '--format',
    '{{.Repository}}:{{.Tag}}']);
  if(result.code !== 0) {
    throw new ExecError(`${docker.format(['image', 'ls'])} failed: ` +
      result.stderr.trim());
  }
  return new Set(result.stdout.split('\n').filter(Boolean));
}

function fullTag(tag) {
  // a tag without a version is :latest; a registry port is not a version
  return /:[^/]*$/.test(tag) ? tag : `${tag}:latest`;
}

function sourceText(image) {
  return image.source === 'built-in' ? 'built-in' :
    image.replacesBuiltIn ? 'yours (replaces built-in)' : 'yours';
}

const list = {
  name: 'ls',
  aliases: ['list'],
  summary: 'List images',
  description: 'List built-in images and yours (~/.config/asb/images), ' +
    'whether Docker has built them, and the asb image each is built FROM.',
  json: true,

  async run(context) {
    const {config, docker, env, notice, c} = context;
    let tags;
    try {
      tags = await builtTags(docker);
    } catch(e) {
      if(!(e instanceof ExecError)) {
        throw e;
      }
      notice(`build states unknown: ${e.message}`);
    }
    const data = [];
    for(const image of Object.values(config.images)) {
      let bases = [];
      let error;
      try {
        bases = await imageBases(image, config.images, {env});
      } catch(e) {
        if(!(e instanceof ConfigError)) {
          throw e;
        }
        error = e.message;
      }
      data.push({
        name: image.name,
        source: image.source,
        ...(image.replacesBuiltIn ? {replacesBuiltIn: true} : {}),
        dir: image.dir,
        tag: image.tag,
        built: tags ? tags.has(fullTag(image.tag)) : null,
        bases,
        ...(image.description ? {description: image.description} : {}),
        ...(error ? {error} : {})
      });
    }
    const rows = [['NAME', 'SOURCE', 'BUILT', 'FROM', 'DESCRIPTION']
      .map(h => c.dim(h))];
    for(const image of data) {
      const built = image.built === null ? c.yellow('unknown') :
        image.built ? c.green('yes') : c.dim('no');
      rows.push([
        image.name,
        sourceText(config.images[image.name]),
        built,
        image.bases.join(', ') || c.dim('-'),
        image.error ? c.red(image.error) : image.description ?? ''
      ]);
    }
    return {data, text: formatTable(rows)};
  }
};

function stubDockerfile(name, base) {
  return `\
# syntax=docker/dockerfile:1
# asb image "${name}", built FROM ${base.tag}. Build it with: asb build ${name}
# (which builds ${base.name} first). Use it in a sandbox with "image: ${name}",
# or for every sandbox with: asb config set defaults.image ${name}
FROM ${base.tag}

# Install as root, then switch back to the sandbox user at the end.
USER root

# The cache mounts keep package downloads out of the image and reuse them
# across builds.
# RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \\
#     --mount=type=cache,target=/var/lib/apt,sharing=locked \\
#     apt-get update && apt-get install -y --no-install-recommends \\
#     vim \\
#     tmux

# Install outside the home directory: the sandbox's home mount replaces it
# at runtime, hiding anything installed there. npm needs an explicit prefix
# (NPM_CONFIG_PREFIX points into the home), and an explicit cache (HOME is
# the sandbox user's). Per-sandbox tools (uv tool install, npm -g) are
# better installed in the sandbox itself.
# RUN --mount=type=cache,target=/root/.npm \\
#     npm_config_cache=/root/.npm \\
#     npm install -g --prefix /usr/local some-tool

# This directory is the build context: COPY files from it, e.g.
# COPY bashrc /etc/bash.bashrc

ARG USERNAME=agent
USER \${USERNAME}
`;
}

async function listFiles(dir, prefix = '') {
  const files = [];
  for(const entry of await fs.readdir(dir, {withFileTypes: true})) {
    const relative = path.join(prefix, entry.name);
    if(entry.isDirectory()) {
      files.push(...await listFiles(path.join(dir, entry.name), relative));
    } else {
      files.push(relative);
    }
  }
  return files.sort();
}

const create = {
  name: 'new',
  aliases: ['create'],
  summary: 'Create an image directory',
  description: 'Create ~/.config/asb/images/<name>/. By default it gets a ' +
    'Dockerfile built FROM another asb image (--from, default: default) ' +
    'to add your own tools to. --copy copies another image\'s whole build ' +
    'context instead, to change it freely. Naming it after a built-in ' +
    'image (e.g. default) replaces that image.',
  arguments: [{name: '<name>', description: 'image name'}],
  options: [
    {flags: '--from <image>',
      description: 'image to build FROM (default: default)',
      conflicts: ['copy']},
    {flags: '--copy <image>', description: 'image to copy'},
    {flags: '-d, --description <text>', description: 'description'}
  ],

  async run(context) {
    const {config, args: [name], options, dryRun, env} = context;
    if(!NAME_PATTERN.test(name)) {
      throw new UsageError(`Invalid image name "${name}": use lowercase ` +
        'letters, digits, ".", "_", or "-", starting with a letter or digit.');
    }
    const dir = path.join(configDir(env), IMAGES_DIR, name);
    if(await pathExists(dir)) {
      throw new UsageError(`${displayPath(dir, env)} already exists.`);
    }
    const files = new Map();
    let copyFrom;
    const settings = {};
    if(options.description) {
      settings.description = options.description;
    }
    if(options.copy) {
      copyFrom = getImage(config.images, options.copy);
      if(!await pathExists(copyFrom.dockerfile)) {
        throw new ConfigError(`Image "${copyFrom.name}" has no ` +
          `Dockerfile: ${displayPath(copyFrom.dockerfile, env)}`);
      }
      settings.description ??= copyFrom.description ?
        `copy of ${copyFrom.name}: ${copyFrom.description}` :
        `copy of ${copyFrom.name}`;
      const dockerfile = path.relative(copyFrom.context, copyFrom.dockerfile);
      if(dockerfile !== 'Dockerfile') {
        settings.dockerfile = dockerfile;
      }
      if(Object.keys(copyFrom.args).length > 0) {
        settings.args = copyFrom.args;
      }
    } else {
      const base = getImage(config.images, options.from ?? 'default');
      files.set('Dockerfile', stubDockerfile(name, base));
    }
    // an image.yaml written by asb; a copied one would keep the old tag
    files.set(IMAGE_FILE, Object.keys(settings).length > 0 ?
      YAML.stringify(settings, {lineWidth: 0}) :
      '# description: what this image is for\n');

    let created = [...files.keys()];
    if(copyFrom) {
      created = [...new Set([...await listFiles(copyFrom.context),
        ...created])].sort();
    }
    if(!dryRun) {
      if(copyFrom) {
        await fs.cp(copyFrom.context, dir, {recursive: true});
      } else {
        await fs.mkdir(dir, {recursive: true});
      }
      for(const [file, text] of files) {
        await fs.writeFile(path.join(dir, file), text);
      }
    }
    const verb = dryRun ? 'would create' : 'created';
    const shown = displayPath(dir, env);
    return {
      text: [
        ...created.map(file => `${verb} ${path.join(shown, file)}`),
        `Edit ${path.join(shown, 'Dockerfile')}, then: asb build ${name}`
      ].join('\n')
    };
  }
};

const show = {
  name: 'show',
  summary: 'Show an image\'s files and settings',
  description: 'Show where an image is defined, its build context and ' +
    'Dockerfile, tag, build args, and the asb images it is built from (in ' +
    'build order). With no name, show the current sandbox\'s image, or ' +
    '"default".',
  arguments: [{name: '[image]', description: 'image name',
    complete: 'images'}],
  json: true,

  async run(context) {
    const {config, args, env} = context;
    const [name] = await imageNames(context, args);
    const image = getImage(config.images, name);
    const chain = (await buildOrder([name], config.images, {env}))
      .map(i => i.name).filter(n => n !== name);
    const shown = file => displayPath(file, env);
    const view = {
      name: image.name,
      ...(image.description ? {description: image.description} : {}),
      source: sourceText(image),
      dir: shown(image.dir),
      ...(image.context === image.dir ? {} : {context: shown(image.context)}),
      dockerfile: shown(image.dockerfile),
      tag: image.tag,
      args: image.args,
      from: chain
    };
    return {
      data: {...image, from: chain},
      text: YAML.stringify(view, {lineWidth: 0}).trimEnd()
    };
  }
};

export default {
  name: 'image',
  helpGroup: 'Sandbox and config commands:',
  summary: 'List, create, or show images',
  subcommands: [list, create, show]
};
