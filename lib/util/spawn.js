/**
 * Child processes. Commands are spawned with an argv array, never through
 * a shell, so arguments keep their quoting.
 */
import {ExecError} from '../errors.js';
import os from 'node:os';
import {spawn} from 'node:child_process';

function defaultNotFound(command) {
  return cause => new ExecError(`Command not found: ${command}`, {cause});
}

/**
 * Spawn a process with the terminal attached and wait for it to exit.
 *
 * @param {string} command - Command.
 * @param {string[]} args - Arguments.
 * @param {object} options - Options.
 * @param {{stdout: object, stderr: object}} options.io - Output streams;
 *   the real process streams are inherited, others are piped into.
 * @param {object} options.env - Environment.
 * @param {Function} [options.notFound] - `cause => Error` for a missing
 *   command.
 *
 * @returns {Promise<number>} Exit code.
 */
export function spawnAttached(command, args, {
  io, env, notFound = defaultNotFound(command)
}) {
  return new Promise((resolve, reject) => {
    // pass the real terminal through when output is not redirected (tests
    // and library callers capture output in their own streams)
    const out = io.stdout === process.stdout ? 'inherit' : 'pipe';
    const err = io.stderr === process.stderr ? 'inherit' : 'pipe';
    const child = spawn(command, args, {env, stdio: ['inherit', out, err]});
    child.stdout?.on('data', chunk => io.stdout.write(chunk));
    child.stderr?.on('data', chunk => io.stderr.write(chunk));
    // the child gets Ctrl-C from the terminal too; let it decide, and exit
    // with its status. Termination signals sent only to asb are passed on.
    const ignore = () => {};
    const forward = signal => child.kill(signal);
    process.on('SIGINT', ignore);
    process.on('SIGTERM', forward);
    process.on('SIGHUP', forward);
    const done = () => {
      process.off('SIGINT', ignore);
      process.off('SIGTERM', forward);
      process.off('SIGHUP', forward);
    };
    child.on('error', error => {
      done();
      reject(error.code === 'ENOENT' ? notFound(error) : error);
    });
    child.on('close', (code, signal) => {
      done();
      // like a shell: 128 + the signal number
      resolve(code ?? 128 + (os.constants.signals[signal] ?? 1));
    });
  });
}

/**
 * Spawn a process, capture its output, and wait for it to exit.
 *
 * @param {string} command - Command.
 * @param {string[]} args - Arguments.
 * @param {object} options - Options.
 * @param {object} options.env - Environment.
 * @param {Function} [options.notFound] - `cause => Error` for a missing
 *   command.
 *
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 *   Result.
 */
export function spawnCaptured(command, args, {
  env, notFound = defaultNotFound(command)
}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env, stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', error => {
      reject(error.code === 'ENOENT' ? notFound(error) : error);
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
