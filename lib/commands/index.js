/**
 * Command registry. The CLI (and help) is generated from these definitions.
 *
 * A command definition:
 *
 * - `name`, `aliases`, `summary`, `description`: naming and help.
 * - `helpGroup`: heading the command is listed under in help.
 * - `config`: false if the command does not need the config loaded.
 * - `passThrough`: everything from the first unknown argument on is passed
 *   through to `args` unparsed.
 * - `arguments`, `options`: extra commander arguments and options.
 * - `json`: add a --json option that prints the returned `data`.
 * - `run(context)`: returns `{exitCode?, data?, text?}`.
 * - `subcommands`: definitions of nested commands (`asb config get`); the
 *   parent then only groups them.
 */
import {logs, status} from './status.js';
import {restart, start, stop} from './lifecycle.js';
import {run, sh} from './exec.js';
import build from './build.js';

export const commands = [
  start,
  stop,
  restart,
  sh,
  run,
  status,
  logs,
  build
];
