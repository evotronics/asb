/**
 * `asb sh` and `asb run`: run commands in a sandbox.
 */
import {execArgs, runArgs} from '../docker/args.js';
import {prepareMounts, requireRunning, useTty} from './common.js';
import {auditNotice} from './audit.js';
import {containerPathFor} from '../sandbox/select.js';
import crypto from 'node:crypto';
import {UsageError} from '../errors.js';

const HELP_GROUP = 'Container commands:';

// follow the current directory into the container when it is mounted
async function workdir(context, sandbox) {
  return await containerPathFor(sandbox, context.cwd) ?? sandbox.workdir;
}

export const sh = {
  name: 'sh',
  aliases: ['shell', 'exec'],
  helpGroup: HELP_GROUP,
  summary: 'Run a shell or command in a running sandbox',
  description: 'Run a command (default: the sandbox\'s shell) in the ' +
    'running container. The working directory is the container path of ' +
    'the current directory when it is in the workspace, a mount, or the ' +
    'home; otherwise the sandbox\'s workdir. asb options must come before ' +
    'the command.',
  passThrough: true,
  arguments: [{name: '[command...]', description: 'command and arguments'}],

  async run(context) {
    const sandbox = await context.sandbox();
    await requireRunning(context, sandbox);
    return {
      exitCode: await context.docker.run(execArgs(sandbox, {
        tty: useTty(context),
        workdir: await workdir(context, sandbox),
        command: context.args
      }))
    };
  }
};

export const run = {
  name: 'run',
  helpGroup: HELP_GROUP,
  summary: 'Run a command in a new, throwaway container',
  description: 'Start a one-shot container with the sandbox\'s settings, ' +
    'run a command, and remove the container. It can run while the ' +
    'sandbox\'s long running container is up. asb options must come ' +
    'before the command.',
  passThrough: true,
  arguments: [{name: '<command...>', description: 'command and arguments'}],

  async run(context) {
    if(context.args.length === 0) {
      throw new UsageError('No command given.');
    }
    const sandbox = await context.sandbox();
    const protect = await prepareMounts(context, sandbox);
    const suffix = crypto.randomBytes(3).toString('hex');
    await auditNotice(context, sandbox);
    const exitCode = await context.docker.run(runArgs(sandbox, {
      detach: false,
      tty: useTty(context),
      protect,
      name: `${sandbox.container}-run-${suffix}`,
      workdir: await workdir(context, sandbox),
      command: context.args
    }));
    if(!context.dryRun) {
      await auditNotice(context, sandbox);
    }
    return {exitCode};
  }
};
