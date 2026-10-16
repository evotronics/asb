/**
 * `asb new`, `asb rm`, `asb ls`, `asb show`, `asb edit`: manage sandboxes.
 */
import {collect, editConfigFile, isRunning} from './common.js';
import {ConfigEditor, editText} from '../config/editor.js';
import {ExecError, UsageError} from '../errors.js';
import {configDir, displayPath, NAME_PATTERN, NAME_RULE,
  SANDBOXES_DIR} from '../config/paths.js';
import {formatCommand, formatTable, printable} from '../util/format.js';
import {containerName, findSandboxEntry, getSandbox, resolveAll,
  resolveSandbox} from '../sandbox/resolve.js';
import {containerStates} from '../docker/run.js';
import {expandProtect} from '../sandbox/protect.js';
import fs from 'node:fs/promises';
import {isDirectory} from '../util/fs.js';
import {listSandboxFiles, loadConfig} from '../config/load.js';
import path from 'node:path';
import {runArgs} from '../docker/args.js';
import {selectSandbox} from '../sandbox/select.js';
import YAML from 'yaml';

const HELP_GROUP = 'Sandbox and config commands:';

// shown at the end of new sandbox files
const HINTS = `\
# Other settings include:
# image: default       # or base, playwright, or one of yours
# workspace: ~/sandboxes/NAME
# mounts: [~/src/shared:shared:ro]
# ports: [5173-5177, 9323]
# network: none
# resources: {cpus: 2, memory: 8g, pids: 1024}
# env: {NODE_ENV: development}
`;

/**
 * Turn a path from the command line into a config path: relative to the
 * current directory, written with `~/` when under the home directory.
 *
 * @param {string} value - Path.
 * @param {object} context - Command context.
 * @param {string} context.cwd - Current directory.
 * @param {object} context.env - Environment.
 *
 * @returns {string} Config path.
 */
function configPath(value, {cwd, env}) {
  if(value === '~' || value.startsWith('~/')) {
    return value;
  }
  return displayPath(path.resolve(cwd, value), env);
}

function parseMountOption(value, context) {
  const parts = value.split(':');
  if(parts.length < 2 || parts.length > 3 ||
    (parts.length === 3 && !['ro', 'rw'].includes(parts[2]))) {
    throw new UsageError(`Invalid --mount "${value}": use SOURCE:TARGET or ` +
      'SOURCE:TARGET:ro.');
  }
  parts[0] = configPath(parts[0], context);
  return parts.join(':');
}

const create = {
  name: 'new',
  aliases: ['create'],
  helpGroup: HELP_GROUP,
  summary: 'Create a sandbox',
  description: 'Write ~/.config/asb/sandboxes/<name>.yaml and create its ' +
    'home and workspace directories if they are missing. Relative paths ' +
    'are relative to the current directory. Edit the file later with ' +
    '`asb edit <name>`.',
  arguments: [{name: '<name>', description: 'sandbox name'}],
  options: [
    {flags: '-w, --workspace <dir>',
      description: 'host directory mounted at ~/workspace'},
    {flags: '--home <dir>', description: 'host directory mounted as HOME ' +
      '(default: ~/.local/share/asb/homes/<name>)'},
    {flags: '--image <name>', description: 'image name'},
    {flags: '-m, --mount <spec>',
      description: 'extra mount, SOURCE:TARGET[:ro] (repeatable)',
      parser: collect},
    {flags: '-p, --port <spec>',
      description: 'published port or range (repeatable)', parser: collect},
    {flags: '--network <name>',
      description: 'docker network: bridge, none, or a network name'},
    {flags: '-d, --description <text>', description: 'description'}
  ],

  async run(context) {
    const {args: [name], options, dryRun, env} = context;
    if(!NAME_PATTERN.test(name)) {
      throw new UsageError(`Invalid sandbox name "${name}": use ${NAME_RULE}.`);
    }
    if(context.config.sandboxes.some(s => s.name === name)) {
      throw new UsageError(`Sandbox "${name}" already exists ` +
        `(edit it with: asb edit ${name}).`);
    }
    const data = {};
    if(options.description) {
      data.description = options.description;
    }
    if(options.image) {
      data.image = options.image;
    }
    if(options.home) {
      data.home = configPath(options.home, context);
    }
    if(options.workspace) {
      data.workspace = configPath(options.workspace, context);
    }
    if(options.mount) {
      data.mounts = options.mount.map(m => parseMountOption(m, context));
    }
    if(options.port) {
      data.ports = options.port.map(p => /^\d+$/.test(p) ? Number(p) : p);
    }
    if(options.network) {
      data.network = options.network;
    }

    const editor = new ConfigEditor({env});
    const file = editor.sandboxFile(name);
    const head = ` asb sandbox "${name}". Show the resolved settings with: ` +
      `asb show ${name}`;
    if(Object.keys(data).length === 0) {
      editor.createText(file, `#${head}\n\n${HINTS}`);
    } else {
      const document = editor.create(file, data, {comment: head});
      document.comment = HINTS.replace(/^# ?/gm, ' ').trimEnd();
    }
    const {changes, config} = await editor.commit({dryRun});
    const sandbox = getSandbox(config, name);

    const messages = [];
    for(const dir of [sandbox.home, sandbox.workspace].filter(Boolean)) {
      if(!await isDirectory(dir)) {
        if(!dryRun) {
          await fs.mkdir(dir, {recursive: true, mode: 0o700});
        }
        messages.push(`${dryRun ? 'would create' : 'created'} directory ` +
          displayPath(dir, env));
      }
    }
    return {
      text: editText(changes, context) +
        (messages.length > 0 ? '\n' + messages.join('\n') : '')
    };
  }
};

const remove = {
  name: 'rm',
  aliases: ['remove'],
  helpGroup: HELP_GROUP,
  summary: 'Remove a sandbox\'s config',
  description: 'Delete a sandbox\'s file in ~/.config/asb/sandboxes. Its ' +
    'home directory and workspace are not touched. A running sandbox must ' +
    'be stopped first.',
  arguments: [{name: '<name>', description: 'sandbox name',
    complete: 'sandboxes'}],

  async run(context) {
    const {args: [name], dryRun, env, notice} = context;
    // not resolved, so a sandbox with broken settings can still be removed
    const entry = findSandboxEntry(context.config, name);
    try {
      if(await isRunning(context, {container: containerName(name)})) {
        throw new UsageError(`Sandbox "${name}" is running (stop it with: ` +
          `asb stop ${name}).`);
      }
    } catch(e) {
      if(!(e instanceof ExecError)) {
        throw e;
      }
      notice(`could not check whether "${name}" is running: ${e.message}`);
    }
    const editor = new ConfigEditor({env});
    await editor.remove(entry.file);
    const {changes} = await editor.commit({dryRun});
    const messages = [];
    let home;
    try {
      ({home} = resolveSandbox(context.config, entry));
    } catch {
      // broken settings, so its home is unknown
    }
    if(home && await isDirectory(home)) {
      messages.push(`kept home directory ${displayPath(home, env)}`);
    }
    return {
      text: [editText(changes, context), ...messages]
        .join('\n')
    };
  }
};

const list = {
  name: 'ls',
  aliases: ['list'],
  helpGroup: HELP_GROUP,
  summary: 'List sandboxes',
  description: 'List sandboxes with their container state, image, and ' +
    'workspace.',
  json: true,

  async run(context) {
    const {config, docker, env, notice, c} = context;
    let states;
    try {
      states = await containerStates(docker);
    } catch(e) {
      if(!(e instanceof ExecError)) {
        throw e;
      }
      notice(`container states unknown: ${e.message}`);
    }
    const data = resolveAll(config).map(({entry, sandbox, error}) => {
      if(error) {
        return {name: entry.name, file: entry.file, error: error.message};
      }
      const runs = states ? [...states.keys()].filter(n =>
        n.startsWith(`${sandbox.container}-run-`)).length : 0;
      return {
        name: sandbox.name,
        file: sandbox.file,
        state: states ? states.get(sandbox.container)?.state ?? 'stopped' :
          'unknown',
        runs,
        image: sandbox.image.name,
        home: sandbox.home,
        ...(sandbox.workspace ? {workspace: sandbox.workspace} : {}),
        ...(sandbox.description ? {description: sandbox.description} : {})
      };
    });
    if(data.length === 0) {
      return {data, text: c.dim('No sandboxes. Create one with: ' +
        'asb new <name>')};
    }
    const rows = [['NAME', 'STATE', 'IMAGE', 'WORKSPACE', 'DESCRIPTION']
      .map(h => c.dim(h))];
    for(const s of data) {
      if(s.error) {
        rows.push([s.name, c.red('invalid'), '', '', s.error]);
        continue;
      }
      const state = s.state === 'running' ? c.green(s.state) :
        s.state === 'stopped' ? c.dim(s.state) : c.yellow(printable(s.state));
      rows.push([
        s.name,
        state + (s.runs > 0 ? c.dim(` +${s.runs} run`) : ''),
        s.image,
        s.workspace ? displayPath(s.workspace, env) : c.dim('-'),
        s.description ?? ''
      ]);
    }
    return {data, text: formatTable(rows)};
  }
};

const show = {
  name: 'show',
  helpGroup: HELP_GROUP,
  summary: 'Show a sandbox\'s resolved settings',
  description: 'Show a sandbox\'s settings with defaults applied and paths ' +
    'expanded, including the protected paths that exist now. --docker ' +
    'prints the `docker run` command `asb start` would use.',
  arguments: [{name: '[sandbox]', description: 'sandbox name',
    complete: 'sandboxes'}],
  options: [
    {flags: '--docker', description: 'print the docker run command'}
  ],
  json: true,

  async run(context) {
    const {env, options} = context;
    const sandbox = await context.sandbox(context.args[0]);
    const protect = sandbox.workspace &&
      await isDirectory(sandbox.workspace) ?
      (await expandProtect(sandbox.workspace, sandbox.protect)).paths : [];
    if(options.docker) {
      const args = runArgs(sandbox, {protect});
      return {
        data: [sandbox.docker, ...args],
        // one option per line, so long commands stay readable
        text: formatCommand(sandbox.docker, args)
          .replace(/ (?=--?[a-z])/g, ' \\\n  ')
      };
    }
    const shown = file => displayPath(file, env);
    const view = {
      name: sandbox.name,
      ...(sandbox.description ? {description: sandbox.description} : {}),
      file: shown(sandbox.file),
      container: sandbox.container,
      image: `${sandbox.image.name} (${sandbox.image.tag}, ` +
        `${sandbox.image.source === 'built-in' ? 'built-in' : 'yours'})`,
      user: `${sandbox.user} (${sandbox.uid}:${sandbox.gid})`,
      home: `${shown(sandbox.home)} -> ${sandbox.containerHome}`,
      ...(sandbox.workspace ? {
        workspace: `${shown(sandbox.workspace)} -> ${sandbox.workspaceTarget}`
      } : {}),
      mounts: sandbox.mounts.map(m => `${shown(m.source)} -> ${m.target}` +
        (m.readonly ? ' (read-only)' : '')),
      protect: sandbox.protect,
      protected: protect,
      workdir: sandbox.workdir,
      ports: sandbox.ports,
      network: sandbox.network,
      resources: sandbox.resources,
      env: sandbox.env,
      readonly: sandbox.readonly,
      tmpExec: sandbox.tmpExec,
      shell: sandbox.shell,
      runArgs: sandbox.runArgs
    };
    return {
      data: {...sandbox, protected: protect},
      text: YAML.stringify(view, {lineWidth: 0}).trimEnd()
    };
  }
};

const edit = {
  name: 'edit',
  helpGroup: HELP_GROUP,
  summary: 'Edit a sandbox\'s file',
  description: 'Open the sandbox\'s file in $VISUAL or $EDITOR, then ' +
    'validate it. A running container keeps its settings until restarted.',
  arguments: [{name: '[sandbox]', description: 'sandbox name',
    complete: 'sandboxes'}],
  // so a broken file can be fixed
  config: false,

  async run(context) {
    const {args, globals, env} = context;
    let name = args[0] ?? globals.sandbox ?? env.ASB_SANDBOX;
    if(!name) {
      const config = await loadConfig({env});
      name = (await selectSandbox(config, {cwd: context.cwd, env})).name;
    }
    const file = (await listSandboxFiles(path.join(configDir(env),
      SANDBOXES_DIR))).find(f => f.name === name)?.file;
    if(!file) {
      throw new UsageError(`Unknown sandbox "${name}" (create it with: ` +
        `asb new ${name}).`);
    }
    return editConfigFile(context, file, {
      fixWith: `asb edit ${name}`,
      validate: async () => getSandbox(await loadConfig({env}), name)
    });
  }
};

export {create, edit, list, remove, show};
