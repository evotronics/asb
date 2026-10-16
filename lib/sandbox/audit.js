/**
 * Audit: look in a sandbox's writable workspace and mounts for things the
 * host would run, which a sandbox could have planted. Read-only mounts
 * over protected paths only cover files that already exist; a sandbox can
 * still create, for example, a `.git/commondir` that points git at a config
 * it wrote, or a new repo with hooks. The audit finds:
 *
 * - git directories using `commondir` outside `.git/worktrees`, and `.git`
 *   files whose git directory is outside the scanned directories;
 * - git config settings that run commands (`core.fsmonitor`,
 *   `core.hooksPath`, aliases starting with `!`, filters, ...);
 * - executable git hooks;
 * - changes to files host tools read and act on (`.envrc`, `.npmrc`,
 *   `.vscode/tasks.json`, `.mpm/config.yaml`, ...).
 *
 * Findings are compared with a baseline saved in the data directory, so
 * existing, reviewed setups (your own hooks, git-lfs filters) aren't
 * reported every time.
 */
import {dataDir, displayPath} from '../config/paths.js';
import {ifExists, isInside, realpathOrSelf} from '../util/fs.js';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {sandboxMounts} from './check.js';
import {spawnCaptured} from '../util/spawn.js';

// how deep to look for repos (e.g. ws/repo/.claude/worktrees/x/.git)
const MAX_DEPTH = 5;
const SKIP_DIRS = new Set(['node_modules']);

// files host tools read and act on: reported when they change
const WATCHED = [
  '.envrc', '.npmrc', '.yarnrc.yml', '.vscode/tasks.json',
  '.vscode/settings.json', '.mpm/config.yaml'
];

// git config keys that make git run a command
const RISKY_KEYS = [
  /^core\.(hookspath|sshcommand|pager|editor|askpass|gitproxy)$/,
  /^core\.alternaterefscommand$/,
  /^sequence\.editor$/,
  /^diff\.external$/,
  /^diff\..+\.(textconv|command)$/,
  /^merge\..+\.driver$/,
  /^filter\..+\.(clean|smudge|process)$/,
  /^credential\.(.+\.)?helper$/,
  /^gpg\.(.+\.)?program$/,
  /^(include|includeif\..+)\.path$/,
  /^pager\./,
  /^interactive\.difffilter$/,
  /^uploadpack\.packobjectshook$/,
  /^remote\..+\.(uploadpack|receivepack)$/
];

/**
 * @typedef {object} Finding
 * @property {string} id - Stable identity, for comparing with a baseline.
 * @property {'commondir'|'gitfile'|'git-config'|'hook'|'file'} kind - Kind.
 * @property {string} file - Absolute path.
 * @property {string} detail - What was found (a value, a hash).
 * @property {boolean} risky - True if it makes the host run something;
 *   false for watched files, which only matter when they change.
 */

/**
 * Audit a sandbox's writable workspace and mounts.
 *
 * @param {import('./resolve.js').Sandbox} sandbox - Sandbox.
 * @param {object} [options] - Options.
 * @param {object} [options.env] - Environment.
 *
 * @returns {Promise<{findings: Finding[], notes: string[]}>} Findings,
 *   sorted, and notes on what couldn't be checked.
 */
export async function auditSandbox(sandbox, {env = process.env} = {}) {
  const roots = [];
  for(const mount of sandboxMounts(sandbox)) {
    // the home is the sandbox's own; host tools don't run things there
    if(mount.writable && mount.what !== 'home') {
      roots.push(await realpathOrSelf(mount.source));
    }
  }
  const state = {findings: new Map(), notes: new Set(), env, roots};
  for(const root of roots) {
    await scanDir(root, 0, state);
  }
  return {
    findings: [...state.findings.values()]
      .sort((a, b) => a.id.localeCompare(b.id)),
    notes: [...state.notes]
  };
}

// files that can't be read are skipped
const UNREADABLE = ['ENOENT', 'ENOTDIR', 'EISDIR', 'EACCES'];

async function scanDir(dir, depth, state) {
  const entries = await ifExists(
    fs.readdir(dir, {withFileTypes: true}), [], UNREADABLE);
  const names = new Set(entries.map(e => e.name));
  for(const file of WATCHED) {
    const [first] = file.split('/');
    if(names.has(first)) {
      await watchFile(path.join(dir, file), state);
    }
  }
  for(const entry of entries) {
    const full = path.join(dir, entry.name);
    if(entry.name === '.git') {
      await checkGit(full, entry, state);
      continue;
    }
    if(entry.isDirectory() && !SKIP_DIRS.has(entry.name) &&
      depth < MAX_DEPTH) {
      await scanDir(full, depth + 1, state);
    }
  }
}

async function watchFile(file, state) {
  const text = await ifExists(fs.readFile(file), undefined, UNREADABLE);
  if(text === undefined) {
    return;
  }
  add(state, {
    kind: 'file', file, risky: false,
    detail: crypto.createHash('sha256').update(text).digest('hex')
  });
}

async function checkGit(dotGit, entry, state) {
  let gitDir = dotGit;
  if(entry.isFile()) {
    const text = await fs.readFile(dotGit, 'utf8').catch(() => '');
    const target = text.match(/^gitdir:\s*(.+?)\s*$/m)?.[1];
    if(!target) {
      return;
    }
    gitDir = path.resolve(path.dirname(dotGit), target);
    const real = await realpathOrSelf(gitDir);
    if(!state.roots.some(root => isInside(real, root))) {
      add(state, {
        kind: 'gitfile', file: dotGit, risky: true,
        detail: `git directory outside the sandbox's mounts: ${target}`
      });
      return;
    }
  } else if(!entry.isDirectory()) {
    return;
  }
  await checkGitDir(gitDir, state, new Set());
}

async function checkGitDir(gitDir, state, seen) {
  const real = await realpathOrSelf(gitDir);
  if(seen.has(real)) {
    return;
  }
  seen.add(real);
  let commonDir = gitDir;
  const commondir = await readText(path.join(gitDir, 'commondir'));
  if(commondir !== undefined) {
    commonDir = path.resolve(gitDir, commondir.trim());
    // linked worktrees have one; a main git directory shouldn't
    if(!/[/\\]\.git[/\\]worktrees[/\\][^/\\]+$/.test(real)) {
      add(state, {
        kind: 'commondir', file: path.join(gitDir, 'commondir'),
        risky: true, detail: `points git at ${commondir.trim()}`
      });
    }
  }
  const configs = [path.join(commonDir, 'config'),
    path.join(gitDir, 'config.worktree')];
  let hooksPath;
  for(const file of configs) {
    for(const {key, value} of await gitConfig(file, state)) {
      if(key === 'core.hookspath') {
        hooksPath = path.resolve(path.dirname(gitDir), value);
      }
      if(isRisky(key, value)) {
        add(state, {
          kind: 'git-config', file, risky: true, key,
          detail: `${key} = ${value}`
        });
      }
    }
  }
  await checkHooks(hooksPath ?? path.join(commonDir, 'hooks'), state);
  // submodules have their own git directories
  for(const name of await readDirNames(path.join(commonDir, 'modules'))) {
    await checkGitDir(path.join(commonDir, 'modules', name), state, seen);
  }
}

function isRisky(key, value) {
  if(key === 'core.fsmonitor') {
    // true and false use git's built-in daemon; anything else is a command
    return !/^(true|false|yes|no|on|off|1|0|)$/i.test(value);
  }
  if(key.startsWith('alias.')) {
    return value.trim().startsWith('!');
  }
  return RISKY_KEYS.some(pattern => pattern.test(key));
}

async function checkHooks(dir, state) {
  for(const name of await readDirNames(dir)) {
    if(name.endsWith('.sample')) {
      continue;
    }
    const file = path.join(dir, name);
    const stat = await fs.stat(file).catch(() => null);
    if(stat?.isFile() && (stat.mode & 0o111)) {
      add(state, {
        kind: 'hook', file, risky: true,
        detail: crypto.createHash('sha256')
          .update(await fs.readFile(file)).digest('hex')
      });
    }
  }
}

/**
 * Read a git config file with git, which only parses it: `--file` with
 * `--no-includes` reads no other files and runs nothing.
 *
 * @param {string} file - Config file.
 * @param {object} state - Scan state.
 *
 * @returns {Promise<Array<{key: string, value: string}>>} Entries.
 */
async function gitConfig(file, state) {
  if(await readText(file) === undefined) {
    return [];
  }
  let result;
  try {
    result = await spawnCaptured('git', ['config', '--file', file,
      '--no-includes', '--list', '--null'], {env: state.env});
  } catch {
    state.notes.add('git was not found, so git config files were not ' +
      'checked');
    return [];
  }
  if(result.code !== 0) {
    state.notes.add(`git could not read ${displayPath(file, state.env)}`);
    return [];
  }
  return result.stdout.split('\0').filter(Boolean).map(entry => {
    const newline = entry.indexOf('\n');
    return newline === -1 ? {key: entry.toLowerCase(), value: ''} : {
      key: entry.slice(0, newline).toLowerCase(),
      value: entry.slice(newline + 1)
    };
  });
}

function add(state, {kind, file, key, detail, risky}) {
  const id = `${kind}:${file}${key ? `:${key}` : ''}`;
  state.findings.set(id, {id, kind, file, detail, risky});
}

async function readText(file) {
  return ifExists(fs.readFile(file, 'utf8'), undefined, UNREADABLE);
}

async function readDirNames(dir) {
  return ifExists(fs.readdir(dir).then(names => names.sort()), [],
    UNREADABLE);
}

/**
 * Where a sandbox's audit baseline is kept. It is in the data directory,
 * which sandboxes can't mount writable.
 *
 * @param {string} name - Sandbox name.
 * @param {object} [env] - Environment.
 *
 * @returns {string} File path.
 */
export function baselineFile(name, env = process.env) {
  return path.join(dataDir(env), 'audit', `${name}.json`);
}

/**
 * Read a sandbox's audit baseline.
 *
 * @param {string} name - Sandbox name.
 * @param {object} [env] - Environment.
 *
 * @returns {Promise<{time: string, findings: Finding[]}|undefined>}
 *   Baseline, if saved.
 */
export async function readBaseline(name, env = process.env) {
  const text = await readText(baselineFile(name, env));
  if(text === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Save findings as a sandbox's audit baseline.
 *
 * @param {string} name - Sandbox name.
 * @param {Finding[]} findings - Findings.
 * @param {object} [env] - Environment.
 */
export async function saveBaseline(name, findings, env = process.env) {
  const file = baselineFile(name, env);
  await fs.mkdir(path.dirname(file), {recursive: true, mode: 0o700});
  await fs.writeFile(file, JSON.stringify(
    {time: new Date().toISOString(), findings}, null, 2) + '\n');
}

/**
 * Compare findings with a baseline. Without a baseline, every risky
 * finding is new (watched files only matter when they change).
 *
 * @param {Finding[]} findings - Current findings.
 * @param {{findings: Finding[]}} [baseline] - Baseline.
 *
 * @returns {{added: Finding[], changed: Finding[], removed: Finding[]}}
 *   Differences.
 */
export function compareAudit(findings, baseline) {
  if(!baseline) {
    return {added: findings.filter(f => f.risky), changed: [], removed: []};
  }
  const before = new Map(baseline.findings.map(f => [f.id, f]));
  const now = new Map(findings.map(f => [f.id, f]));
  return {
    added: findings.filter(f => !before.has(f.id)),
    changed: findings.filter(f => before.has(f.id) &&
      before.get(f.id).detail !== f.detail),
    removed: baseline.findings.filter(f => !now.has(f.id))
  };
}
