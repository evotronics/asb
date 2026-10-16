#!/usr/bin/env node
/**
 * Fake docker CLI for tests. Every call's arguments are appended as a JSON
 * line to `$FAKE_DOCKER_DIR/calls.log`.
 *
 * `$FAKE_DOCKER_DIR/containers.json` (optional) lists containers as
 * `[{name, sandbox, state, status, ports}]`. `ps --quiet --filter name=^X$`
 * prints an id if X is running; `ps --format ...` with `{{.Names}}\t...`
 * prints containers labeled `asb.sandbox`. `$FAKE_DOCKER_DIR/exit` (optional)
 * holds the exit code for other commands. `image ls` prints the
 * `repository:tag` values in `$FAKE_DOCKER_DIR/images.json` (optional).
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = process.env.FAKE_DOCKER_DIR;
const args = process.argv.slice(2);
fs.appendFileSync(path.join(dir, 'calls.log'), JSON.stringify(args) + '\n');

const read = (name, fallback) => {
  const file = path.join(dir, name);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : fallback;
};
const containers = JSON.parse(read('containers.json', '[]'));

if(args[0] === 'ps') {
  if(args.includes('--quiet')) {
    const filter = args[args.indexOf('--filter') + 1];
    const name = filter.replace(/^name=\^/, '').replace(/\$$/, '');
    if(containers.some(c => c.name === name && c.state === 'running')) {
      process.stdout.write('0123456789ab\n');
    }
  } else if(args.at(-1).startsWith('{{.Names}}')) {
    for(const c of containers) {
      process.stdout.write(
        [c.name, c.state, c.status ?? '', c.ports ?? ''].join('\t') + '\n');
    }
  } else {
    process.stdout.write('NAMES  STATUS  PORTS\n');
  }
  process.exit(0);
}
if(args[0] === 'image' && args[1] === 'ls') {
  for(const tag of JSON.parse(read('images.json', '[]'))) {
    process.stdout.write(`${tag}\n`);
  }
  process.exit(0);
}
if(args[0] === 'stop') {
  // containers are started with --rm
  fs.writeFileSync(path.join(dir, 'containers.json'), JSON.stringify(
    containers.filter(c => !args.includes(c.name))));
}
process.stdout.write(`fake docker ${args[0]}\n`);
process.exit(Number(read('exit', '0')));
