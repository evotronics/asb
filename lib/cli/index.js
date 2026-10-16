/**
 * Command line interface: builds a commander program from the command
 * registry and runs commands.
 */
import {AsbError, EXIT} from '../errors.js';
import {Command, CommanderError, Option} from 'commander';
import {createColors, shouldUseColor} from '../util/format.js';
import {complete, definitions} from './complete.js';
import {commands} from '../commands/index.js';
import {createDocker} from '../docker/run.js';
import {defaultSettings, loadConfig} from '../config/load.js';
import fs from 'node:fs';
import path from 'node:path';
import {selectSandbox} from '../sandbox/select.js';

const pkg = JSON.parse(fs.readFileSync(
  path.join(import.meta.dirname, '..', '..', 'package.json'), 'utf8'));

const GLOBAL_OPTIONS = [
  {
    short: '-s', long: '--sandbox <name>',
    description: 'sandbox to use (default: $ASB_SANDBOX, or the sandbox ' +
      'whose workspace, home, or mounts contain the current directory)'
  },
  {
    short: '-n', long: '--dry-run',
    description: 'print docker commands and config changes instead of ' +
      'running or making them'
  },
  {short: '-v', long: '--verbose', description: 'show more detail'},
  {long: '--color', description: 'force color output'},
  {long: '--no-color', description: 'disable color output'}
];

const GLOBAL_KEYS = ['sandbox', 'dryRun', 'verbose', 'color'];

/**
 * Run the CLI.
 *
 * @param {string[]} argv - Arguments, not including node and script.
 * @param {object} [options] - Options.
 * @param {object} [options.stdout] - Output stream.
 * @param {object} [options.stderr] - Error stream.
 * @param {string} [options.cwd] - Current directory.
 * @param {object} [options.env] - Environment.
 *
 * @returns {Promise<number>} Exit code.
 */
export async function main(argv, {
  stdout = process.stdout, stderr = process.stderr, cwd = process.cwd(),
  env = process.env
} = {}) {
  const io = {stdout, stderr};
  const state = {exitCode: EXIT.OK};
  const program = createProgram({io, cwd, env, state});
  try {
    await program.parseAsync(argv, {from: 'user'});
  } catch(e) {
    if(e instanceof CommanderError) {
      // help and version exit with 0; parse errors are usage errors
      return e.exitCode === 0 ? EXIT.OK : EXIT.USAGE;
    }
    throw e;
  }
  return state.exitCode;
}

/**
 * Create the commander program.
 *
 * @param {object} options - Options.
 * @param {object} options.io - Streams.
 * @param {string} options.cwd - Current directory.
 * @param {object} options.env - Environment.
 * @param {object} options.state - Receives `exitCode`.
 *
 * @returns {Command} Program.
 */
export function createProgram({io, cwd, env, state}) {
  const program = new Command('asb')
    .description('Anything Sandbox: run agents or untrusted code in named, ' +
      'hardened Docker containers.')
    .version(pkg.version, '-V, --version')
    .enablePositionalOptions()
    .exitOverride()
    .configureOutput({
      writeOut: text => io.stdout.write(text),
      writeErr: text => io.stderr.write(text)
    })
    .configureHelp({showGlobalOptions: true, sortSubcommands: false})
    .showSuggestionAfterError()
    .addHelpText('after', `
Config is in ~/.config/asb (or $ASB_CONFIG_DIR): config.yaml, and one
sandboxes/NAME.yaml per sandbox. Run "asb <command> --help" for details.`);

  for(const option of GLOBAL_OPTIONS) {
    program.addOption(createOption(option));
  }
  for(const definition of commands) {
    addCommand(program, definition, {program, io, cwd, env, state});
  }

  // used by the scripts from `asb completion <shell>`
  program.command('__complete', {hidden: true})
    .argument('[words...]')
    .allowUnknownOption()
    .passThroughOptions()
    .action(async words => {
      let lines = [];
      try {
        lines = await complete({program, words, env});
      } catch {
        // never break the shell with errors
      }
      if(lines.length > 0) {
        io.stdout.write(lines.join('\n') + '\n');
      }
    });
  return program;
}

function addCommand(parent, definition, options) {
  const {io} = options;
  const cmd = parent.command(definition.name)
    .summary(definition.summary)
    .description(definition.description ?? definition.summary)
    .exitOverride()
    .configureOutput({
      writeOut: text => io.stdout.write(text),
      writeErr: text => io.stderr.write(text)
    });
  definitions.set(cmd, definition);
  for(const alias of definition.aliases ?? []) {
    cmd.alias(alias);
  }
  if(definition.helpGroup) {
    cmd.helpGroup(definition.helpGroup);
  }
  // accept global options after the command name too; they are listed
  // under "Global Options" in help
  const addGlobals = () => {
    for(const option of GLOBAL_OPTIONS) {
      if(cmd.options.some(o => o.long === option.long.split(' ')[0])) {
        continue;
      }
      cmd.addOption(createOption({
        ...option,
        // e.g. `asb logs -n 20` is docker's -n, not asb's
        short: definition.shortGlobals === false ? undefined : option.short
      }).hideHelp());
    }
  };

  if(definition.subcommands) {
    cmd.enablePositionalOptions();
    addGlobals();
    for(const subcommand of definition.subcommands) {
      addCommand(cmd, {
        ...subcommand,
        fullName: `${definition.fullName ?? definition.name} ` +
          subcommand.name
      }, options);
    }
    return cmd;
  }

  if(definition.passThrough) {
    cmd.passThroughOptions().allowUnknownOption();
  }
  for(const argument of definition.arguments ?? []) {
    cmd.argument(argument.name, argument.description);
  }
  for(const option of definition.options ?? []) {
    cmd.addOption(createCommandOption(option));
  }
  if(definition.json) {
    cmd.addOption(new Option('--json', 'JSON output'));
  }
  addGlobals();

  cmd.action(async (...actionArgs) => {
    // commander passes declared arguments, then options, then the command
    const positional = actionArgs.slice(0, -2).flat()
      .filter(a => a !== undefined);
    options.state.exitCode = await executeCommand({
      ...options,
      definition: {...definition, name: definition.fullName ?? definition.name},
      cmd,
      positional
    });
  });
  return cmd;
}

async function executeCommand({
  definition, cmd, program, positional, io, cwd, env
}) {
  const options = cmd.opts();
  const globals = mergeGlobals(program, cmd);
  const colors = shouldUseColor({color: globals.color, stream: io.stdout, env});
  const c = createColors(colors);
  const errorColors = createColors(
    shouldUseColor({color: globals.color, stream: io.stderr, env}));
  const dryRun = Boolean(globals.dryRun);
  const verbose = Boolean(globals.verbose);
  const notice = message => io.stderr.write(`asb: ${message}\n`);

  try {
    const config = definition.config === false ? undefined :
      await loadConfig({env});
    const docker = createDocker({
      command: config?.settings.docker ?? defaultSettings().docker,
      dryRun,
      io,
      env
    });
    const context = {
      config,
      args: positional,
      options,
      globals,
      dryRun,
      verbose,
      io,
      env,
      cwd,
      c,
      docker,
      notice,
      /**
       * Select the sandbox to act on.
       *
       * @param {string} [name] - Name given as a command argument; it must
       *   match -s if both are given.
       *
       * @returns {Promise<object>} Resolved sandbox.
       */
      sandbox(name) {
        if(name && globals.sandbox && name !== globals.sandbox) {
          throw new AsbError(`Sandbox "${name}" given as an argument and ` +
            `"${globals.sandbox}" with -s.`);
        }
        return selectSandbox(config, {name: name ?? globals.sandbox, cwd,
          env});
      }
    };
    const output = await definition.run(context) ?? {};
    if(options.json && output.data !== undefined) {
      io.stdout.write(JSON.stringify(output.data, null, 2) + '\n');
    } else if(output.text) {
      io.stdout.write(output.text + '\n');
    }
    return output.exitCode ?? EXIT.OK;
  } catch(error) {
    return reportError({error, io, c: errorColors, verbose});
  }
}

function reportError({error, io, c, verbose}) {
  const known = error instanceof AsbError;
  io.stderr.write(`${c.red('asb: error:')} ${error.message}\n`);
  for(const detail of error.details ?? []) {
    io.stderr.write(`  ${detail}\n`);
  }
  if(!known || verbose) {
    io.stderr.write(c.dim(`${error.stack}\n`));
  }
  return known ? error.exitCode : EXIT.FAILED;
}

function mergeGlobals(program, cmd) {
  // the value given closest to the command wins, e.g.
  // `asb -s a start -s b`
  const globals = {};
  for(const key of GLOBAL_KEYS) {
    globals[key] = program.opts()[key];
    for(let current = cmd; current && current !== program;
      current = current.parent) {
      if(current.getOptionValueSource(key) === 'cli') {
        globals[key] = current.opts()[key];
        break;
      }
    }
  }
  return globals;
}

function createOption({short, long, description}) {
  return new Option(short ? `${short}, ${long}` : long, description);
}

function createCommandOption({
  flags, description, choices, parser, default: value, conflicts
}) {
  const option = new Option(flags, description);
  if(parser) {
    option.argParser(parser);
  }
  if(choices) {
    option.choices(choices);
  }
  if(value !== undefined) {
    option.default(value);
  }
  if(conflicts) {
    option.conflicts(conflicts);
  }
  return option;
}
