/**
 * `asb audit`: look for things in a sandbox's writable mounts that the
 * host would run, and changes since the last reviewed baseline.
 */
import {auditSandbox, baselineFile, compareAudit, readBaseline, saveBaseline}
  from '../sandbox/audit.js';
import {displayPath} from '../config/paths.js';
import {EXIT} from '../errors.js';
import {printable} from '../util/format.js';

const KIND_LABELS = {
  commondir: 'git commondir',
  gitfile: '.git file',
  'git-config': 'git config',
  hook: 'git hook',
  file: 'watched file'
};

/**
 * Format a finding for display.
 *
 * @param {import('../sandbox/audit.js').Finding} finding - Finding.
 * @param {object} env - Environment.
 *
 * @returns {string} Text.
 */
export function findingText(finding, env) {
  const detail = finding.kind === 'file' || finding.kind === 'hook' ?
    '' : `: ${finding.detail.length > 120 ?
      finding.detail.slice(0, 117) + '...' : finding.detail}`;
  return printable(`${KIND_LABELS[finding.kind]} ` +
    `${displayPath(finding.file, env)}${detail}`);
}

/**
 * Audit a sandbox and report differences from its baseline as notices,
 * for the automatic checks around start, stop, and run. Saves a first
 * baseline if there is none.
 *
 * @param {object} context - Command context.
 * @param {import('../sandbox/resolve.js').Sandbox} sandbox - Sandbox.
 */
export async function auditNotice(context, sandbox) {
  const {env, dryRun, notice} = context;
  const {findings} = await auditSandbox(sandbox, {env});
  const baseline = await readBaseline(sandbox.name, env);
  if(!baseline) {
    if(!dryRun) {
      await saveBaseline(sandbox.name, findings, env);
    }
    const risky = findings.filter(f => f.risky);
    if(risky.length > 0) {
      notice(`audit: saved a first baseline for "${sandbox.name}" with ` +
        `${risky.length} thing${risky.length === 1 ? '' : 's'} the host ` +
        `would run; review with: asb audit ${sandbox.name}`);
    }
    return;
  }
  const {added, changed} = compareAudit(findings, baseline);
  const lines = [
    ...added.map(f => `  new: ${findingText(f, env)}`),
    ...changed.map(f => `  changed: ${findingText(f, env)}`)
  ];
  if(lines.length > 0) {
    notice(`audit: ${lines.length} change${lines.length === 1 ? '' : 's'} ` +
      `in sandbox "${sandbox.name}" since its baseline that the host could ` +
      'run or read:');
    for(const line of lines) {
      notice(line);
    }
    notice(`review them before running tools there; then accept them with: ` +
      `asb audit ${sandbox.name} --accept`);
  }
}

export default {
  name: 'audit',
  helpGroup: 'Sandbox and config commands:',
  summary: 'Check a sandbox\'s mounts for things the host would run',
  description: 'Look in the sandbox\'s writable workspace and mounts for ' +
    'git setups that run commands on the host (a planted .git/commondir, ' +
    '.git files pointing elsewhere, git config such as core.fsmonitor or ' +
    'core.hooksPath, executable hooks) and for changes to files host ' +
    'tools act on (.envrc, .npmrc, .vscode/tasks.json, .mpm/config.yaml). ' +
    'Results are compared with a baseline, saved on first start or with ' +
    '--accept. This also runs on start, stop, and after run. Exits 1 if ' +
    'there are new or changed findings.',
  arguments: [{name: '[sandbox]', description: 'sandbox name',
    complete: 'sandboxes'}],
  options: [
    {flags: '--accept', description: 'save the current state as the ' +
      'baseline, after reviewing it'},
    {flags: '-a, --all', description: 'list every finding, not only ' +
      'changes'}
  ],
  json: true,

  async run(context) {
    const {env, options, dryRun, c} = context;
    const sandbox = await context.sandbox(context.args[0]);
    const {findings, notes} = await auditSandbox(sandbox, {env});
    const baseline = await readBaseline(sandbox.name, env);
    const diff = compareAudit(findings, baseline);
    const lines = [];
    if(baseline) {
      lines.push(c.dim(`Baseline from ${baseline.time}.`));
    } else {
      lines.push(c.dim('No baseline yet; every finding is new.'));
    }
    const section = (title, list, color) => {
      if(list.length > 0) {
        lines.push(title);
        lines.push(...list.map(f => `  ${color(findingText(f, env))}`));
      }
    };
    section('New:', diff.added, c.red);
    section('Changed:', diff.changed, c.yellow);
    section('Gone:', diff.removed, c.dim);
    if(options.all) {
      section('All findings:', findings, s => s);
    }
    const count = diff.added.length + diff.changed.length;
    if(count === 0) {
      lines.push(c.green('No new or changed findings.'));
    }
    for(const note of notes) {
      lines.push(c.yellow(`Note: ${note}.`));
    }
    if(options.accept) {
      if(!dryRun) {
        await saveBaseline(sandbox.name, findings, env);
      }
      lines.push(`${dryRun ? 'would save' : 'saved'} the baseline ` +
        displayPath(baselineFile(sandbox.name, env), env));
    }
    return {
      data: {sandbox: sandbox.name, baseline: baseline?.time ?? null,
        ...diff, findings, notes},
      text: lines.join('\n'),
      exitCode: count > 0 && !options.accept ? EXIT.FAILED : EXIT.OK
    };
  }
};
