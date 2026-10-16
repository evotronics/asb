/**
 * `asb status` and `asb logs`: container state and output.
 */
import {EXIT} from '../errors.js';
import {nameFilter} from './common.js';
import {containerName, findSandboxEntry, LABEL}
  from '../sandbox/resolve.js';

const HELP_GROUP = 'Container commands:';

export const status = {
  name: 'status',
  aliases: ['ps'],
  helpGroup: HELP_GROUP,
  summary: 'Show sandbox containers',
  description: 'Show the containers of all sandboxes (including `asb run` ' +
    'containers), or of the given sandboxes, with docker ps.',
  arguments: [{name: '[sandboxes...]', description: 'sandbox names',
    complete: 'sandboxes'}],

  async run(context) {
    const filters = ['--filter', `label=${LABEL}`];
    // name filters are or'ed; `asb run` containers are NAME-run-XXXXXX
    for(const name of context.args) {
      const container = containerName(
        findSandboxEntry(context.config, name).name);
      filters.push('--filter', nameFilter(container, '(-run-[0-9a-f]+)?'));
    }
    const code = await context.docker.run(['ps', '--all', ...filters,
      '--format', 'table {{.Names}}\t{{.Status}}\t{{.Ports}}']);
    return {exitCode: code === 0 ? EXIT.OK : EXIT.FAILED};
  }
};

export const logs = {
  name: 'logs',
  helpGroup: HELP_GROUP,
  summary: 'Show a sandbox container\'s output',
  description: 'Run docker logs for the current sandbox\'s container; ' +
    'arguments such as -f are passed to docker logs.',
  passThrough: true,
  // docker logs has its own -n (--tail)
  shortGlobals: false,
  arguments: [{name: '[args...]', description: 'docker logs arguments'}],

  async run(context) {
    const sandbox = await context.sandbox();
    const code = await context.docker.run(
      ['logs', ...context.args, sandbox.container]);
    return {exitCode: code === 0 ? EXIT.OK : EXIT.FAILED};
  }
};
