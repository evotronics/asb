/**
 * Run docker. Commands are spawned with an argv array, never through a
 * shell, so arguments keep their quoting.
 */
import {ExecError} from '../errors.js';
import {formatCommand} from '../util/format.js';
import {spawn} from 'node:child_process';

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
  return {
    command,
    dryRun,

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
      return spawnAttached(command, args, {io, env});
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
      return spawnCaptured(command, args, {env});
    },

    format(args) {
      return formatCommand(command, args);
    }
  };
}

function notFound(command, cause) {
  return new ExecError(`Command not found: ${command} (is Docker ` +
    'installed? the command can be set with "asb config set docker ' +
    '<command>")', {cause});
}

function spawnAttached(command, args, {io, env}) {
  return new Promise((resolve, reject) => {
    // pass the real terminal through when output is not redirected (tests
    // and library callers capture output in their own streams)
    const out = io.stdout === process.stdout ? 'inherit' : 'pipe';
    const err = io.stderr === process.stderr ? 'inherit' : 'pipe';
    const child = spawn(command, args, {env, stdio: ['inherit', out, err]});
    child.stdout?.on('data', chunk => io.stdout.write(chunk));
    child.stderr?.on('data', chunk => io.stderr.write(chunk));
    // the child gets Ctrl-C from the terminal too; let it decide, and exit
    // with its status
    const ignore = () => {};
    process.on('SIGINT', ignore);
    const done = () => process.off('SIGINT', ignore);
    child.on('error', error => {
      done();
      reject(error.code === 'ENOENT' ? notFound(command, error) : error);
    });
    child.on('close', (code, signal) => {
      done();
      resolve(code ?? (signal === 'SIGINT' ? 130 : 1));
    });
  });
}

function spawnCaptured(command, args, {env}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env, stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', error => {
      reject(error.code === 'ENOENT' ? notFound(command, error) : error);
    });
    child.on('close', code => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString()
      });
    });
  });
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
