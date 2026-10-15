/**
 * Test fixtures.
 */
import fs from 'node:fs/promises';
import {main} from '../../lib/cli/index.js';
import os from 'node:os';
import path from 'node:path';
import {Writable} from 'node:stream';

const tempDirs = [];

/**
 * Create a temporary directory, removed by `removeTempDirs()`.
 *
 * @returns {Promise<string>} Path.
 */
export async function tempDir() {
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'asb-test-')));
  tempDirs.push(dir);
  return dir;
}

/**
 * Remove temporary directories created by this test file.
 */
export async function removeTempDirs() {
  await Promise.all(tempDirs.splice(0).map(
    dir => fs.rm(dir, {recursive: true, force: true})));
}

/**
 * Write files under a directory.
 *
 * @param {string} dir - Base directory.
 * @param {object} files - Map of relative path to content.
 */
export async function writeFiles(dir, files) {
  for(const [file, content] of Object.entries(files)) {
    const full = path.join(dir, file);
    await fs.mkdir(path.dirname(full), {recursive: true});
    await fs.writeFile(full, content);
  }
}

/**
 * Run the CLI in-process and capture output.
 *
 * @param {string[]} argv - Arguments.
 * @param {object} [options] - Options.
 * @param {string} [options.cwd] - Current directory.
 * @param {object} [options.env] - Extra environment.
 *
 * @returns {Promise<{code: number, stdout: string, stderr: string}>} Result.
 */
export async function run(argv, {cwd, env = {}} = {}) {
  const stdout = capture();
  const stderr = capture();
  const code = await main(argv, {
    stdout,
    stderr,
    cwd,
    env: {...process.env, NO_COLOR: '1', ...env}
  });
  return {code, stdout: stdout.text(), stderr: stderr.text()};
}

function capture() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(chunk);
      callback();
    }
  });
  stream.text = () => Buffer.concat(chunks).toString();
  return stream;
}
