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

export const FAKE_DOCKER = path.join(import.meta.dirname, 'fake-docker.js');

/**
 * Create an isolated environment: a home directory, an asb config
 * directory using the fake docker, and sandbox files.
 *
 * @param {object} [options] - Options.
 * @param {string} [options.config] - Extra config.yaml text.
 * @param {object} [options.sandboxes] - Map of name to sandbox file text.
 * @param {object} [options.configFiles] - Map of path relative to the
 *   config directory to content.
 * @param {object} [options.files] - Map of path relative to the home
 *   directory to content.
 *
 * @returns {Promise<object>} `{dir, home, configDir, env, calls(),
 *   setContainers(list), setImages(tags), setExit(code)}`; `calls()` returns
 *   the fake docker's argv arrays.
 */
export async function createEnv({
  config = '', sandboxes = {}, configFiles = {}, files = {}
} = {}) {
  const dir = await tempDir();
  const home = path.join(dir, 'home');
  const configDir = path.join(dir, 'config');
  const dockerDir = path.join(dir, 'docker');
  await fs.mkdir(home, {recursive: true});
  await fs.mkdir(dockerDir);
  await writeFiles(configDir, {
    'config.yaml': `version: 1\nsettings:\n  docker: ${FAKE_DOCKER}\n` +
      config,
    ...Object.fromEntries(Object.entries(sandboxes).map(
      ([name, text]) => [`sandboxes/${name}.yaml`, text])),
    ...configFiles
  });
  await writeFiles(home, files);
  return {
    dir,
    home,
    configDir,
    env: {
      HOME: home,
      ASB_CONFIG_DIR: configDir,
      XDG_DATA_HOME: path.join(dir, 'data'),
      FAKE_DOCKER_DIR: dockerDir
    },
    async calls() {
      const text = await fs.readFile(path.join(dockerDir, 'calls.log'),
        'utf8').catch(() => '');
      return text.split('\n').filter(Boolean).map(line => JSON.parse(line));
    },
    async setContainers(list) {
      await fs.writeFile(path.join(dockerDir, 'containers.json'),
        JSON.stringify(list));
    },
    async setImages(list) {
      await fs.writeFile(path.join(dockerDir, 'images.json'),
        JSON.stringify(list));
    },
    async setExit(code) {
      await fs.writeFile(path.join(dockerDir, 'exit'), String(code));
    }
  };
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
