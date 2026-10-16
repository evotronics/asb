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
 * - `shortGlobals`: false to only accept long forms of global options after
 *   the command name (to avoid clashing with pass through arguments).
 * - `arguments`, `options`: extra commander arguments and options. An
 *   argument's `complete` names its shell completion: `sandboxes`,
 *   `images`, `config-keys`, `shells`, `files`, or `dirs`.
 * - `json`: add a --json option that prints the returned `data`.
 * - `run(context)`: returns `{exitCode?, data?, text?}`.
 * - `subcommands`: definitions of nested commands (`asb config get`); the
 *   parent then only groups them.
 */
import {logs, status} from './status.js';
import {restart, start, stop} from './lifecycle.js';
import {run, sh} from './exec.js';
import {create, edit, list, remove, show} from './sandbox.js';
import audit from './audit.js';
import build from './build.js';
import completion from './completion.js';
import config from './config.js';
import image from './image.js';

export const commands = [
  create,
  remove,
  list,
  show,
  edit,
  audit,
  image,
  build,
  config,
  completion,
  start,
  stop,
  restart,
  sh,
  run,
  status,
  logs
];
