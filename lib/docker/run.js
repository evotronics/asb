/**
 * Run docker. Commands are spawned with an argv array, never through a
 * shell, so arguments keep their quoting.
 */
import {spawnAttached, spawnCaptured} from '../util/spawn.js';
import {ExecError} from '../errors.js';
import {formatCommand} from '../util/format.js';

/**
 * Create a docker runner.
 *
 * @param {object} options - Options.
 * @param {string} options.command - Docker command (`docker`, `podman`).
 * @param {boolean} options.dryRun - Print commands that change things
 *   instead of running them.
 * @param {{stdout: object, stderr: object}} options.io - Output streams.
 * @param {object} options.env - Environment.
 *
 * @returns {{run: Function, query: Function, format: Function}} Runner.
 */
export function createDocker({command, dryRun, io, env}) {
  const notFound = cause => new ExecError(`Command not found: ${command} ` +
    '(is Docker installed? the command can be set with "asb config set ' +
    'docker <command>")', {cause});
  return {
    /**
     * Run a docker command with the terminal attached, or print it in dry
     * run mode.
     *
     * @param {string[]} args - Arguments.
     *
     * @returns {Promise<number>} Exit code.
     */
    async run(args) {
      if(dryRun) {
        io.stdout.write(`+ ${formatCommand(command, args)}\n`);
        return 0;
      }
      return spawnAttached(command, args, {io, env, notFound});
    },

    /**
     * Run a read-only docker command and capture its output. Runs in dry
     * run mode too.
     *
     * @param {string[]} args - Arguments.
     *
     * @returns {Promise<{code: number, stdout: string, stderr: string}>}
     *   Result.
     */
    query(args) {
      return spawnCaptured(command, args, {env, notFound});
    },

    format(args) {
      return formatCommand(command, args);
    }
  };
}

/**
 * Container states of sandboxes, from `docker ps`.
 *
 * @param {object} docker - Runner from `createDocker`.
 *
 * @returns {Promise<Map<string, {state: string, status: string,
 *   ports: string}>>} State by container name.
 */
export async function containerStates(docker) {
  const result = await docker.query(['ps', '--all', '--filter',
    'label=asb.sandbox', '--format',
    '{{.Names}}\t{{.State}}\t{{.Status}}\t{{.Ports}}']);
  if(result.code !== 0) {
    throw new ExecError(`${docker.format(['ps'])} failed: ` +
      result.stderr.trim());
  }
  const states = new Map();
  for(const line of result.stdout.split('\n').filter(Boolean)) {
    const [name, state, status, ports = ''] = line.split('\t');
    states.set(name, {state, status, ports});
  }
  return states;
}
