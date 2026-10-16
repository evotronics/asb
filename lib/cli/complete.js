/**
 * Shell completion engine, used by the hidden `asb __complete` command
 * that the scripts from `asb completion <shell>` call.
 *
 * Given the words typed after `asb` (the last one being the word under the
 * cursor, possibly empty), returns candidate lines: `value` or
 * `value<TAB>description`. The special single line `__files__` or
 * `__dirs__` asks the shell for its own file or directory completion.
 */
import {defaultSettings, loadConfig} from '../config/load.js';

/** Command definitions by commander command, set by the CLI builder. */
export const definitions = new WeakMap();

const FILES = ['__files__'];
const DIRS = ['__dirs__'];
// option value completions, by option attribute name
const OPTION_KINDS = {
  sandbox: 'sandboxes',
  image: 'images',
  workspace: 'dirs',
  home: 'dirs',
  mount: 'files'
};

/**
 * Compute completions.
 *
 * @param {object} options - Options.
 * @param {object} options.program - Commander program.
 * @param {string[]} options.words - Words after `asb`; the last is the word
 *   being completed.
 * @param {object} options.env - Environment.
 *
 * @returns {Promise<string[]>} Candidate lines.
 */
export async function complete({program, words, env}) {
  const current = words.length > 0 ? words.at(-1) : '';
  const state = walk(program, words.slice(0, -1));
  const data = createDataSource({env});

  if(state.passThrough) {
    return FILES;
  }
  if(state.expectValue) {
    const option = state.expectValue;
    const kind = option.argChoices ? null :
      OPTION_KINDS[option.attributeName()];
    const values = option.argChoices ?
      option.argChoices.map(value => line(value)) :
      await kindValues(kind, data);
    return filter(values, current);
  }
  if(current.startsWith('-') && !state.afterDoubleDash) {
    return filter(optionCandidates(state.cmd, program), current);
  }
  const subcommands = visibleCommands(state.cmd);
  if(subcommands.length > 0) {
    return filter(subcommands.map(c =>
      line(c.name(), c.summary() || c.description())), current);
  }
  const definition = definitions.get(state.cmd);
  if(definition?.passThrough && state.positional === 0 &&
    !definition.arguments?.[0]?.complete) {
    // the start of a command to run
    return FILES;
  }
  const kind = positionalKind(definition, state.positional);
  return filter(await kindValues(kind, data), current);
}

/**
 * Walk the typed words through the command tree.
 *
 * @param {object} program - Commander program.
 * @param {string[]} tokens - Complete words before the cursor.
 *
 * @returns {object} `{cmd, positional, expectValue, passThrough,
 *   afterDoubleDash}`.
 */
function walk(program, tokens) {
  const state = {
    cmd: program, positional: 0, expectValue: null, passThrough: false,
    afterDoubleDash: false
  };
  for(const token of tokens) {
    const definition = definitions.get(state.cmd);
    if(state.passThrough) {
      break;
    }
    if(state.expectValue) {
      state.expectValue = null;
      continue;
    }
    if(token === '--' && !state.afterDoubleDash) {
      if(definition?.passThrough) {
        state.passThrough = true;
      } else {
        state.afterDoubleDash = true;
      }
      continue;
    }
    if(token.startsWith('-') && token !== '-' && !state.afterDoubleDash) {
      const {option, attached} = findOption(state.cmd, token);
      if(option?.required && !attached) {
        state.expectValue = option;
      } else if(!option && definition?.passThrough) {
        // unknown options start the pass-through arguments
        state.passThrough = true;
      }
      continue;
    }
    const sub = state.positional === 0 && visibleCommands(state.cmd)
      .find(c => c.name() === token || c.aliases().includes(token));
    if(sub) {
      state.cmd = sub;
      continue;
    }
    if(definition?.passThrough) {
      state.passThrough = true;
      continue;
    }
    state.positional++;
  }
  return state;
}

function findOption(cmd, token) {
  const [name, value] = token.split(/=(.*)/s);
  let option = cmd.options.find(o => o.long === name || o.short === name);
  if(option) {
    return {option, attached: value !== undefined};
  }
  // short option with an attached value, e.g. -swidget
  if(/^-[A-Za-z]./.test(token)) {
    option = cmd.options.find(o => o.short === token.slice(0, 2));
    if(option) {
      return {option, attached: option.required};
    }
  }
  return {option: null, attached: false};
}

function visibleCommands(cmd) {
  return cmd.commands.filter(c => !c._hidden && c.name() !== 'help');
}

function optionCandidates(cmd, program) {
  const candidates = [];
  const options = cmd === program ? program.options : cmd.options;
  for(const option of options) {
    for(const flag of [option.long, option.short]) {
      if(flag) {
        candidates.push(line(flag, option.description));
      }
    }
  }
  candidates.push(line('--help', 'display help for command'));
  return candidates;
}

function positionalKind(definition, index) {
  const args = definition?.arguments ?? [];
  if(index < args.length) {
    return args[index].complete ?? null;
  }
  const last = args.at(-1);
  return last?.name.includes('...') ? last.complete ?? null : null;
}

async function kindValues(kind, data) {
  switch(kind) {
    case 'files':
      return FILES;
    case 'dirs':
      return DIRS;
    case 'shells':
      return ['bash', 'zsh', 'fish'].map(shell => line(shell));
    case 'sandboxes': {
      const config = await data.config();
      return (config?.sandboxes ?? []).map(s =>
        line(s.name, s.data.description));
    }
    case 'images': {
      const config = await data.config();
      return Object.keys(config?.images ?? {default: {}})
        .map(name => line(name));
    }
    case 'config-keys':
      return [
        ...Object.keys(defaultSettings()).map(key => line(key, 'setting')),
        ...Object.keys(defaultSettings()).map(key => line(`settings.${key}`)),
        line('defaults.', 'sandbox defaults')
      ];
    default:
      return [];
  }
}

/**
 * Lazily load the config, ignoring errors (completion must never fail
 * loudly).
 *
 * @param {object} options - Options.
 * @param {object} options.env - Environment.
 *
 * @returns {object} Data accessors.
 */
function createDataSource({env}) {
  let configPromise;
  return {
    config() {
      configPromise ??= loadConfig({env}).catch(() => null);
      return configPromise;
    }
  };
}

function line(value, description) {
  return description ? `${value}\t${description.split('\n')[0]}` : value;
}

function filter(candidates, current) {
  if(candidates === FILES || candidates === DIRS) {
    return candidates;
  }
  return candidates.filter(c => c.startsWith(current) && c !== '');
}
