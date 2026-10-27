/**
 * `asb doctor`: check the config, each sandbox's paths, mounts, and image,
 * docker, and git, and suggest fixes, including for git worktrees, which
 * break between the host and the container unless they use relative
 * paths.
 */
import {checkMounts, checkUser} from '../sandbox/check.js';
import {configDir, displayPath} from '../config/paths.js';
import {ConfigError, EXIT, ExecError} from '../errors.js';
import {formatCommand, printable} from '../util/format.js';
import {gitVersion, readGitConfig, RELATIVE_WORKTREES_GIT, versionAtLeast}
  from '../util/git.js';
import {ifExists, isDirectory, isInside, pathExists} from '../util/fs.js';
import {createDocker, imageTags} from '../docker/run.js';
import {expandProtect} from '../sandbox/protect.js';
import {findSandboxEntry, resolveAll} from '../sandbox/resolve.js';
import fs from 'node:fs/promises';
import {fullTag} from '../config/images.js';
import {isRunning} from './common.js';
import {loadConfig} from '../config/load.js';
import path from 'node:path';

const MINIMUM = RELATIVE_WORKTREES_GIT.join('.');
const SYMBOLS = {ok: '✓', hint: '•', warn: '!', error: '✗'};
const TRUE = /^(true|yes|on|1)$/i;

export default {
  name: 'doctor',
  helpGroup: 'Sandbox and config commands:',
  summary: 'Check the config, sandboxes, docker, and git',
  description: 'Check that the config files are valid, that each ' +
    'sandbox\'s workspace, home, and mounts exist and are safe to mount, ' +
    'and that its image is built; check docker and git; and suggest git ' +
    'settings for worktrees and branches in sandboxes, which have a ' +
    'read-only .git/config. Checks every sandbox, or the ones named. ' +
    'Changes nothing. Exits 1 if there are problems.',
  arguments: [{name: '[sandboxes...]', description: 'sandbox names',
    complete: 'sandboxes'}],
  config: false,
  json: true,

  async run(context_) {
    const {env, c} = context_;
    const report = createReport();
    report.section('setup');
    let config;
    try {
      config = await loadConfig({env});
    } catch(e) {
      if(!(e instanceof ConfigError)) {
        throw e;
      }
      report.add('error', e.message, {details: e.details});
      return output(report, c);
    }
    // the config isn't loaded for this command, so docker isn't set up
    const {dryRun, io} = context_;
    const docker = createDocker({command: config.settings.docker, dryRun,
      io, env});
    const context = {...context_, config, docker};
    const names = context.args.length > 0 ? context.args :
      context.globals.sandbox ? [context.globals.sandbox] : null;
    for(const name of names ?? []) {
      findSandboxEntry(config, name);
    }
    const imageCount = Object.keys(config.images).length;
    report.add('ok', `config ${show(configDir(env), env)} is valid ` +
      `(${plural(config.sandboxes.length, 'sandbox')}, ` +
      `${plural(imageCount, 'image')})`);
    try {
      checkUser(config.settings);
    } catch(e) {
      report.add('error', e.message);
    }

    const tags = await checkDocker(context, report);
    const host = await checkHostGit(context, config, report);
    const results = resolveAll(config)
      .filter(r => !names || names.includes(r.entry.name));
    let protectedRepos = false;
    for(const {entry, sandbox, error} of results) {
      report.section(`sandbox ${entry.name}`);
      if(error) {
        report.add('error', error.message, {details: error.details});
        continue;
      }
      const repos = await checkSandbox(context, config, sandbox, report,
        {tags});
      if(repos.length > 0 && host) {
        protectedRepos = true;
        await checkSandboxGit(context, sandbox, repos, report, {host});
      }
    }
    if(protectedRepos && host.relative && !host.globalRelative) {
      report.section('setup');
      report.add('hint', 'worktrees you make on the host link with host ' +
        'paths, which break in sandboxes', {fix: [
        'git config --global worktree.useRelativePaths true']});
    }
    return output(report, c);
  }
};

async function checkDocker(context, report) {
  const {docker} = context;
  const command = docker.format([]);
  let result;
  try {
    result = await docker.query(['version', '--format',
      '{{.Server.Version}}']);
  } catch(e) {
    if(!(e instanceof ExecError)) {
      throw e;
    }
    report.add('error', e.message);
    return undefined;
  }
  if(result.code !== 0) {
    report.add('error', `${command} can't reach its daemon`, {
      details: result.stderr.trim().split('\n').slice(0, 3).map(printable)
    });
    return undefined;
  }
  report.add('ok', printable(`${command} ${result.stdout.trim()}`));
  try {
    return await imageTags(docker);
  } catch(e) {
    if(!(e instanceof ExecError)) {
      throw e;
    }
    report.add('warn', e.message);
    return undefined;
  }
}

async function checkHostGit(context, config, report) {
  const {env} = context;
  const git = config.settings.git;
  let version;
  try {
    version = await gitVersion(git, env);
  } catch(e) {
    if(!(e instanceof ExecError)) {
      throw e;
    }
    report.add('warn', `${e.message} asb audit and the git checks need it.`);
    return undefined;
  }
  const relative = versionAtLeast(version.parts, RELATIVE_WORKTREES_GIT);
  if(relative) {
    report.add('ok', `git ${version.text}`);
  } else {
    report.add('warn', `git ${version.text}: relative worktree paths need ` +
      `git ${MINIMUM} or later`);
  }
  const global = await readGitConfig(git, ['--global'], env)
    .catch(() => ({entries: []}));
  return {
    git, version, relative,
    globalRelative: TRUE.test(lastValue(global.entries,
      'worktree.userelativepaths') ?? '')
  };
}

/**
 * Check a sandbox's paths, mounts, image, and protected paths.
 *
 * @param {object} context - Command context.
 * @param {object} config - Config.
 * @param {object} sandbox - Sandbox.
 * @param {object} report - Report.
 * @param {object} options - Options.
 * @param {Set<string>} [options.tags] - Built image tags, if known.
 *
 * @returns {Promise<string[]>} Repos in the workspace whose `.git/config`
 *   is protected.
 */
async function checkSandbox(context, config, sandbox, report, {tags}) {
  const {env} = context;
  let workspace = false;
  if(sandbox.workspace) {
    workspace = await isDirectory(sandbox.workspace);
    report.add(workspace ? 'ok' : 'error', `workspace ` +
      `${show(sandbox.workspace, env)}${workspace ? '' :
        ' does not exist'}`);
  }
  if(await isDirectory(sandbox.home)) {
    report.add('ok', `home ${show(sandbox.home, env)}`);
  } else if(sandbox.defaultHome) {
    report.add('ok', `home ${show(sandbox.home, env)} (created on first ` +
      'start)');
  } else {
    report.add('error', `home ${show(sandbox.home, env)} does not exist`);
  }
  for(const [i, mount] of sandbox.mounts.entries()) {
    if(!await pathExists(mount.source)) {
      report.add('error', `mounts[${i}] ${show(mount.source, env)} does ` +
        'not exist');
    }
  }
  try {
    await checkMounts(config, sandbox);
    report.add('ok', 'mounts are safe');
  } catch(e) {
    if(!(e instanceof ConfigError)) {
      throw e;
    }
    report.add('error', e.message, {details: e.details});
  }

  const {image} = sandbox;
  if(tags) {
    if(tags.has(fullTag(image.tag))) {
      report.add('ok', `image ${image.name} (${image.tag}) is built`);
    } else {
      report.add('warn', `image ${image.name} (${image.tag}) is not built`,
        {fix: [`asb build ${image.name}`]});
    }
  }

  if(!workspace) {
    return [];
  }
  const {paths, symlinks, hardLinks} = await expandProtect(sandbox.workspace,
    sandbox.protect);
  const unprotectable = [
    ...symlinks.map(p => `${printable(p)} is a symlink`),
    ...hardLinks.map(p => `${printable(p)} has another hard link`)
  ];
  if(unprotectable.length > 0) {
    report.add('error', 'protected paths that a read-only mount can\'t ' +
      'cover; asb start will refuse them (asb audit can show how they got ' +
      'there)', {details: unprotectable});
  } else {
    report.add('ok', `${plural(paths.length, 'protected path')}`);
  }
  return paths
    .map(p => p.match(/^(?:(.+)\/)?\.git\/config$/))
    .filter(Boolean)
    .map(match => path.join(sandbox.workspace, match[1] ?? ''));
}

/**
 * Suggest git settings for a sandbox whose repos have a read-only
 * `.git/config`: no branch tracking, and relative worktree links.
 *
 * @param {object} context - Command context.
 * @param {object} sandbox - Sandbox.
 * @param {string[]} repos - Repo directories with a protected config.
 * @param {object} report - Report.
 * @param {object} options - Options.
 * @param {object} options.host - Host git, from `checkHostGit`.
 */
async function checkSandboxGit(context, sandbox, repos, report, {host}) {
  const {env} = context;
  const {git} = host;
  const enabled = [];
  const disabled = [];
  const fromSandbox = [];
  const fromHost = [];
  // the same path on both sides needs no fixing
  const moved = sandbox.workspace !== sandbox.workspaceTarget;
  for(const repo of repos) {
    const {entries} = await readGitConfig(git,
      ['--file', path.join(repo, '.git', 'config')], env)
      .catch(() => ({entries: []}));
    const relative = TRUE.test(lastValue(entries,
      'extensions.relativeworktrees') ?? '');
    (relative ? enabled : disabled).push(repo);
    for(const link of await worktreeLinks(repo)) {
      if(moved && path.isAbsolute(link)) {
        const target = containerToHost(sandbox, link);
        if(target && !await pathExists(link)) {
          fromSandbox.push({repo, worktree: path.dirname(target)});
        } else if(isInside(link, sandbox.workspace)) {
          fromHost.push({repo, worktree: path.dirname(link)});
        }
      }
    }
  }

  // the sandbox's own global git config, in its home
  const entries = [];
  for(const file of [path.join(sandbox.home, '.config', 'git', 'config'),
    path.join(sandbox.home, '.gitconfig')]) {
    if(await pathExists(file)) {
      entries.push(...(await readGitConfig(git, ['--file', file], env)
        .catch(() => ({entries: []}))).entries);
    }
  }
  const gitconfig = path.join(sandbox.home, '.gitconfig');
  const set = (key, value) => formatCommand('git', ['config', '--file',
    gitconfig, key, value]);
  const fixes = [];
  if(lastValue(entries, 'branch.autosetupmerge') !== 'false') {
    fixes.push(set('branch.autoSetupMerge', 'false'));
  }
  if(lastValue(entries, 'push.default') !== 'current') {
    fixes.push(set('push.default', 'current'));
  }
  if(fixes.length > 0) {
    report.add('hint', 'git records branch tracking in .git/config, which ' +
      'is read-only in the sandbox; set these in its ' +
      show(gitconfig, env), {fix: fixes});
  }

  const sandboxRelative = TRUE.test(lastValue(entries,
    'worktree.userelativepaths') ?? '');
  if(enabled.length > 0 && !host.relative) {
    report.add('error', `git ${host.version.text} can't use repos with ` +
      `relative worktrees; upgrade it to ${MINIMUM} or later`, {
      details: enabled.map(repo => show(repo, env))});
  }
  if(!host.relative) {
    return;
  }
  if(disabled.length > 0) {
    report.add(sandboxRelative ? 'warn' : 'hint', sandboxRelative ?
      'the sandbox uses relative worktrees, but these repos don\'t have ' +
      'them enabled, so git worktree add fails there; enable them on the ' +
      'host' :
      'worktrees made in the sandbox link with container paths, which ' +
      'break on the host; enable relative worktrees (git ' +
      `${MINIMUM}+ everywhere these repos are used)`, {
      details: disabled.map(repo => show(repo, env)),
      fix: [enableRelative(disabled)]
    });
  }
  if(!sandboxRelative) {
    report.add('hint', 'make worktrees with relative paths in the sandbox ' +
      'too', {fix: [set('worktree.useRelativePaths', 'true')]});
  } else if(disabled.length === 0) {
    report.add('ok', 'relative worktrees are set up');
  }
  if(fromSandbox.length > 0) {
    report.add('warn', 'worktrees made in the sandbox link with container ' +
      'paths, so they are broken on the host', {
      fix: fromSandbox.map(({repo, worktree}) => formatCommand('git',
        ['-C', repo, 'worktree', 'repair', '--relative-paths', worktree]))
    });
  }
  if(fromHost.length > 0) {
    report.add('hint', 'worktrees made on the host link with host paths, ' +
      'so they are broken in the sandbox', {
      fix: [...new Set(fromHost.map(({repo}) => formatCommand('git',
        ['-C', repo, 'worktree', 'repair', '--relative-paths'])))]
    });
  }
  await checkContainerGit(context, sandbox, report,
    {needed: enabled.length > 0 || sandboxRelative});
}

async function checkContainerGit(context, sandbox, report, {needed}) {
  if(!needed || !await isRunning(context, sandbox)) {
    return;
  }
  const result = await context.docker.query(['exec', sandbox.container,
    'git', '--version']);
  const match = result.code === 0 &&
    result.stdout.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if(!match) {
    return;
  }
  const parts = match.slice(1).map(n => Number(n ?? 0));
  if(versionAtLeast(parts, RELATIVE_WORKTREES_GIT)) {
    report.add('ok', `git ${match[0]} in the container`);
  } else {
    report.add('error', `git ${match[0]} in the container can't use ` +
      `relative worktrees; the image needs git ${MINIMUM} or later`);
  }
}

// commands that enable relative worktrees in repos
function enableRelative(repos) {
  const steps = repo => `git -C ${repo} config ` +
    `core.repositoryFormatVersion 1 && git -C ${repo} config ` +
    'extensions.relativeWorktrees true';
  if(repos.length === 1) {
    return steps(formatCommand(repos[0]));
  }
  return `for repo in ${repos.map(r => formatCommand(r)).join(' ')}; do ` +
    `${steps('"$repo"')}; done`;
}

// the worktree paths recorded in a repo's .git/worktrees/*/gitdir files
async function worktreeLinks(repo) {
  const dir = path.join(repo, '.git', 'worktrees');
  const links = [];
  for(const name of await ifExists(fs.readdir(dir), [])) {
    const text = await ifExists(
      fs.readFile(path.join(dir, name, 'gitdir'), 'utf8'), '');
    if(text.trim()) {
      links.push(text.trim());
    }
  }
  return links;
}

// a container path in the sandbox's workspace or mounts, as a host path
function containerToHost(sandbox, file) {
  const pairs = [
    ...(sandbox.workspace ? [[sandbox.workspaceTarget, sandbox.workspace]] :
      []),
    ...sandbox.mounts.map(m => [m.target, m.source])
  ];
  for(const [target, source] of pairs) {
    if(file === target || file.startsWith(target + '/')) {
      return path.join(source, file.slice(target.length));
    }
  }
  return undefined;
}

function lastValue(entries, key) {
  return entries.findLast(e => e.key === key)?.value;
}

function createReport() {
  const checks = [];
  let section;
  return {
    checks,
    section(name) {
      section = name;
    },
    add(level, message, {details = [], fix = []} = {}) {
      checks.push({section, level, message: printable(message),
        details: details.map(printable), fix});
    }
  };
}

function output(report, c) {
  const colors = {ok: c.green, hint: c.cyan, warn: c.yellow, error: c.red};
  const lines = [];
  const sections = [...new Set(report.checks.map(check => check.section))];
  for(const section of sections) {
    lines.push(c.bold(section === 'setup' ? 'Setup' :
      section.replace(/^sandbox /, 'Sandbox ')));
    for(const check of report.checks.filter(x => x.section === section)) {
      lines.push(`  ${colors[check.level](SYMBOLS[check.level])} ` +
        check.message);
      lines.push(...check.details.map(detail => `      ${c.dim(detail)}`));
      lines.push(...check.fix.map(fix => `      $ ${fix}`));
    }
  }
  const count = level => report.checks.filter(x => x.level === level).length;
  const counts = [
    [count('error'), 'problem'],
    [count('warn'), 'warning'],
    [count('hint'), 'suggestion']
  ].filter(([n]) => n > 0).map(([n, word]) => plural(n, word));
  lines.push(counts.length > 0 ? `${counts.join(', ')}.` :
    c.green('No problems found.'));
  return {
    data: report.checks,
    text: lines.join('\n'),
    exitCode: count('error') > 0 ? EXIT.FAILED : EXIT.OK
  };
}

function show(file, env) {
  return printable(displayPath(file, env));
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : word.endsWith('x') ? 'es' : 's'}`;
}
