/**
 * `asb start`, `asb stop`, `asb restart`: container lifecycle.
 */
import {isRunning, prepareMounts} from './common.js';
import {EXIT} from '../errors.js';
import {getSandbox} from '../sandbox/resolve.js';
import {runArgs} from '../docker/args.js';
import {UsageError} from '../errors.js';

const HELP_GROUP = 'Container commands:';

const SANDBOX_ARGUMENT = {
  name: '[sandbox]',
  description: 'sandbox name (default: -s, $ASB_SANDBOX, or the current ' +
    'directory)'
};

async function startSandbox(context, sandbox) {
  const protect = await prepareMounts(context, sandbox);
  if(await isRunning(context, sandbox)) {
    throw new UsageError(`Sandbox "${sandbox.name}" is already running ` +
      `(enter it with: asb sh -s ${sandbox.name}, or stop it with: ` +
      `asb stop ${sandbox.name}).`);
  }
  const code = await context.docker.run(runArgs(sandbox, {protect}));
  if(code === 0 && !context.dryRun) {
    context.notice(`started ${sandbox.container}; enter it with: ` +
      `asb sh -s ${sandbox.name}`);
  }
  return code === 0 ? EXIT.OK : EXIT.FAILED;
}

export const start = {
  name: 'start',
  aliases: ['up'],
  helpGroup: HELP_GROUP,
  summary: 'Start a sandbox container (detached)',
  description: 'Start the sandbox\'s container in the background, with ' +
    '--rm so nothing outside its mounts is kept. Missing default home ' +
    'directories are created. Protected workspace paths are mounted ' +
    'read-only.',
  arguments: [SANDBOX_ARGUMENT],

  async run(context) {
    return {exitCode: await startSandbox(context,
      await context.sandbox(context.args[0]))};
  }
};

export const stop = {
  name: 'stop',
  aliases: ['down'],
  helpGroup: HELP_GROUP,
  summary: 'Stop sandbox containers',
  arguments: [{
    name: '[sandboxes...]',
    description: 'sandbox names (default: the current sandbox)'
  }],

  async run(context) {
    const sandboxes = context.args.length > 0 ?
      context.args.map(name => getSandbox(context.config, name)) :
      [await context.sandbox()];
    const code = await context.docker.run(
      ['stop', ...sandboxes.map(s => s.container)]);
    return {exitCode: code === 0 ? EXIT.OK : EXIT.FAILED};
  }
};

export const restart = {
  name: 'restart',
  helpGroup: HELP_GROUP,
  summary: 'Stop (if running) and start a sandbox container',
  description: 'Stop the sandbox\'s container if it is running, then ' +
    'start it again, for example to apply config changes.',
  arguments: [SANDBOX_ARGUMENT],

  async run(context) {
    const sandbox = await context.sandbox(context.args[0]);
    if(context.dryRun || await isRunning(context, sandbox)) {
      const code = await context.docker.run(['stop', sandbox.container]);
      if(code !== 0) {
        return {exitCode: EXIT.FAILED};
      }
    }
    return {exitCode: await startSandbox(context, sandbox)};
  }
};
