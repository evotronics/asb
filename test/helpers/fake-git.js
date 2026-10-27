#!/usr/bin/env node
/**
 * Fake git for tests: `--version` prints `$FAKE_GIT_VERSION` (default
 * 2.51.0); anything else runs the real git.
 */
import {spawnSync} from 'node:child_process';

const args = process.argv.slice(2);
if(args[0] === '--version') {
  process.stdout.write(
    `git version ${process.env.FAKE_GIT_VERSION ?? '2.51.0'}\n`);
  process.exit(0);
}
const result = spawnSync('git', args, {stdio: 'inherit'});
process.exit(result.status ?? 1);
