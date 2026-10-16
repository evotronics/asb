#!/usr/bin/env node
/**
 * Fake docker CLI for tests. Every call's arguments are appended as a JSON
 * line to `$FAKE_DOCKER_DIR/calls.log`.
 *
 * `$FAKE_DOCKER_DIR/containers.json` (optional) lists containers as
 * `[{name, sandbox, state, status, ports}]`.
 * - `ps --quiet --filter name=REGEX` prints an id if a running container
 *   matches (any container with `--all`); like docker, the filter value is
 *   a regular expression.
 * - `ps --format ...` with `{{.Names}}\t...` prints all containers.
 * - `stop` marks containers `removing`; they disappear after the number of
 *   `ps --all --quiet` calls in `$FAKE_DOCKER_DIR/remove-lag` (default 0),
 *   like docker removing `--rm` containers shortly after they stop.
 * - `image ls` prints the `repository:tag` values in
 *   `$FAKE_DOCKER_DIR/images.json` (optional).
 * - `$FAKE_DOCKER_DIR/exit` (optional) holds the exit code for other
 *   commands.
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
let containers = JSON.parse(read('containers.json', '[]'));
const save = () => fs.writeFileSync(path.join(dir, 'containers.json'),
  JSON.stringify(containers));

if(args[0] === 'ps') {
  if(args.includes('--quiet')) {
    const filter = args[args.indexOf('--filter') + 1];
    const pattern = new RegExp(filter.replace(/^name=/, ''));
    const all = args.includes('--all');
    if(containers.some(c => pattern.test(c.name) &&
      (all || c.state === 'running'))) {
      process.stdout.write('0123456789ab\n');
    }
    if(all) {
      for(const c of containers.filter(c => c.state === 'removing')) {
        c.lag -= 1;
      }
      containers = containers.filter(c =>
        c.state !== 'removing' || c.lag > 0);
      save();
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
  // containers are started with --rm, and docker removes them a moment
  // after they stop
  const lag = Number(read('remove-lag', '0'));
  for(const c of containers.filter(c => args.includes(c.name))) {
    Object.assign(c, {state: 'removing', lag});
  }
  containers = containers.filter(c => c.state !== 'removing' || c.lag > 0);
  save();
}
process.stdout.write(`fake docker ${args[0]}\n`);
process.exit(Number(read('exit', '0')));
