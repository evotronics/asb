/**
 * `asb config <subcommand>`: settings and sandbox defaults in config.yaml.
 */
import {ConfigEditor, editText} from '../config/editor.js';
import {defaultSettings, loadConfig} from '../config/load.js';
import {ConfigError} from '../errors.js';
import {configDir, displayPath} from '../config/paths.js';
import {openInEditor} from './common.js';
import {resolveSandbox} from '../sandbox/resolve.js';
import {UsageError} from '../errors.js';
import YAML from 'yaml';

const SETTINGS = Object.keys(defaultSettings());

const TEMPLATE = `\
# asb config. Sandboxes are in sandboxes/NAME.yaml and images in
# images/NAME/ next to this file.
version: 1
# settings:
#   user: agent       # user name in the container
#   docker: docker    # or podman
# defaults:           # applied to every sandbox
#   image: default
#   resources: {cpus: 4, memory: 16g, pids: 2048}
`;

/**
 * Convert a key to a path in config.yaml. Setting names are shorthand for
 * `settings.<name>`.
 *
 * @param {string} key - Dotted key.
 *
 * @returns {string[]} Path.
 */
function keyPath(key) {
  const parts = key.split('.').filter(Boolean);
  if(parts.length === 0) {
    throw new UsageError(`Invalid key "${key}".`);
  }
  if(parts.length === 1 && SETTINGS.includes(parts[0])) {
    return ['settings', parts[0]];
  }
  return parts;
}

function effectiveConfig(config) {
  return {
    settings: config.settings,
    defaults: config.defaults
  };
}

function formatValue(value) {
  return value !== null && typeof value === 'object' ?
    YAML.stringify(value, {lineWidth: 0}).trimEnd() : String(value);
}

const get = {
  name: 'get',
  summary: 'Show settings and sandbox defaults, or one value',
  description: 'Show config.yaml values with built-in defaults applied, ' +
    'e.g. `asb config get uid` or `asb config get defaults.resources`. ' +
    '--show-origin tells where each setting came from.',
  arguments: [{
    name: '[key]', description: 'dotted key', complete: 'config-keys'
  }],
  options: [
    {flags: '--show-origin', description: 'show where settings come from'}
  ],
  json: true,

  async run({config, args, options, c}) {
    const effective = effectiveConfig(config);
    const origins = config.settingOrigins;
    if(!args[0]) {
      if(options.showOrigin) {
        const lines = Object.entries(config.settings).map(([key, value]) =>
          `${key}: ${value}  ${c.dim(`(${origins[key]})`)}`);
        return {data: {...effective, origins}, text: lines.join('\n')};
      }
      return {data: effective, text: formatValue(effective)};
    }
    const parts = keyPath(args[0]);
    let value = effective;
    for(const part of parts) {
      value = value?.[part];
    }
    if(value === undefined) {
      throw new UsageError(`"${args[0]}" is not set.`);
    }
    const origin = parts[0] === 'settings' && parts.length === 2 ?
      origins[parts[1]] : undefined;
    if(options.showOrigin) {
      return {
        data: {value, origin: origin ?? null},
        text: formatValue(value) + (origin ? c.dim(`  (${origin})`) : '')
      };
    }
    return {data: value, text: formatValue(value)};
  }
};

const set = {
  name: 'set',
  summary: 'Set a value in config.yaml',
  description: 'Set a value, keeping comments, e.g. `asb config set docker ' +
    'podman` or `asb config set defaults.resources.memory 8g`. Values are ' +
    'parsed as YAML, so `[a, b]` is a list and `4` a number.',
  arguments: [
    {name: '<key>', description: 'dotted key',
      complete: 'config-keys'},
    {name: '<value>', description: 'value (YAML)'}
  ],

  async run(context) {
    const {args: [key, text], env, dryRun} = context;
    let value;
    try {
      value = YAML.parse(text);
    } catch(e) {
      throw new UsageError(`Invalid value ${JSON.stringify(text)}: ` +
        `${e.message.split('\n')[0]} (quote it to set a string, e.g. ` +
        `'"${text}"').`);
    }
    const editor = new ConfigEditor({env});
    const document = await editor.configDocument();
    try {
      document.setIn(keyPath(key), document.createNode(value));
    } catch(e) {
      // e.g. a key below a value that isn't a map
      throw new UsageError(`Unable to set "${key}": ${e.message}`);
    }
    const {changes} = await editor.commit({dryRun});
    return {text: editText({messages: [], changes}, context)};
  }
};

const unset = {
  name: 'unset',
  summary: 'Remove a value from config.yaml',
  arguments: [{name: '<key>', description: 'dotted key',
    complete: 'config-keys'}],

  async run(context) {
    const {args: [key], env, dryRun, config} = context;
    const editor = new ConfigEditor({env});
    const parts = keyPath(key);
    if(!config.exists || !(await editor.configDocument()).hasIn(parts)) {
      throw new UsageError(`"${key}" is not set in ` +
        `${displayPath(config.file, env)}.`);
    }
    (await editor.configDocument()).deleteIn(parts);
    const {changes} = await editor.commit({dryRun});
    return {text: editText({messages: [], changes}, context)};
  }
};

const paths = {
  name: 'path',
  summary: 'Print the config directory',
  description: 'Print the config directory (~/.config/asb, or ' +
    '$ASB_CONFIG_DIR).',
  config: false,

  async run({env}) {
    return {text: configDir(env)};
  }
};

const validate = {
  name: 'validate',
  summary: 'Check config.yaml and every sandbox file',

  async run({config, env}) {
    for(const entry of config.sandboxes) {
      resolveSandbox(config, entry);
    }
    const count = config.sandboxes.length;
    return {text: `${displayPath(config.dir, env)} is valid ` +
      `(${count} sandbox${count === 1 ? '' : 'es'})`};
  }
};

const edit = {
  name: 'edit',
  summary: 'Open config.yaml in an editor',
  description: 'Open config.yaml in $VISUAL or $EDITOR (creating it from ' +
    'a template if needed), then validate the config.',
  config: false,

  async run(context) {
    const editor = new ConfigEditor({env: context.env});
    const file = editor.configFile;
    if(!await openInEditor(context, file, {template: TEMPLATE})) {
      return {};
    }
    try {
      const config = await loadConfig({env: context.env});
      for(const entry of config.sandboxes) {
        resolveSandbox(config, entry);
      }
    } catch(e) {
      if(e instanceof ConfigError) {
        e.message = `${e.message} Fix it with: asb config edit`;
      }
      throw e;
    }
    return {text: `${displayPath(file, context.env)} is valid`};
  }
};

export default {
  name: 'config',
  helpGroup: 'Sandbox and config commands:',
  summary: 'Show or change settings and sandbox defaults',
  subcommands: [get, set, unset, paths, validate, edit]
};
