/**
 * Command line interface.
 */
import {Command, CommanderError} from 'commander';
import {EXIT} from '../errors.js';
import fs from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(fs.readFileSync(
  path.join(import.meta.dirname, '..', '..', 'package.json'), 'utf8'));

/**
 * Run the CLI.
 *
 * @param {string[]} argv - Arguments, not including node and script.
 * @param {object} [options] - Options.
 * @param {object} [options.stdout] - Output stream.
 * @param {object} [options.stderr] - Error stream.
 *
 * @returns {Promise<number>} Exit code.
 */
export async function main(argv, {
  stdout = process.stdout, stderr = process.stderr
} = {}) {
  const program = new Command('asb')
    .description('Anything Sandbox: run agents or untrusted code in named, ' +
      'hardened Docker containers.')
    .version(pkg.version, '-V, --version')
    .exitOverride()
    .configureOutput({
      writeOut: text => stdout.write(text),
      writeErr: text => stderr.write(text)
    });
  try {
    await program.parseAsync(argv, {from: 'user'});
  } catch(e) {
    if(e instanceof CommanderError) {
      return e.exitCode === 0 ? EXIT.OK : EXIT.USAGE;
    }
    throw e;
  }
  return EXIT.OK;
}
