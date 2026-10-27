import {beforeEach, describe, expect, it} from 'vitest';
import {createEnv, FAKE_GIT, run, writeFiles} from '../helpers/fixtures.js';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('doctor', () => {
  let t;
  let ws;
  let env;

  beforeEach(async () => {
    t = await createEnv({
      config: `  git: ${FAKE_GIT}\n`,
      sandboxes: {w: 'workspace: ~/ws\n'},
      files: {
        'ws/a/.git/config': '[core]\n\tbare = false\n',
        'ws/b/.git/config': '[core]\n\tbare = false\n',
        '.gitconfig-host': ''
      }
    });
    ws = path.join(t.home, 'ws');
    env = {...t.env, GIT_CONFIG_GLOBAL: path.join(t.home, '.gitconfig-host')};
    await t.setImages(['asb-default:latest']);
  });

  const asb = (argv, extra = {}) => run(argv, {
    cwd: t.home, env: {...env, ...extra}
  });

  it('suggests git settings until they are set up', async () => {
    let result = await asb(['doctor']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/✓ config \S+\/config is valid/);
    expect(result.stdout).toMatch(/✓ git 2\.51\.0/);
    expect(result.stdout).toMatch(/✓ image default \(asb-default\) is built/);
    expect(result.stdout).toMatch(
      /\$ git config --file \S+homes\/w\/\.gitconfig branch\.autoSetupMerge/);
    expect(result.stdout).toMatch(/\$ for repo in \S+\/ws\/a \S+\/ws\/b; do/);
    expect(result.stdout).toMatch(
      /\$ git config --global worktree\.useRelativePaths true/);
    expect(result.stdout).toMatch(/4 suggestions\.$/m);

    const home = path.join(t.dir, 'data/asb/homes/w');
    await writeFiles(home, {'.gitconfig': '[branch]\n' +
      '\tautoSetupMerge = false\n[push]\n\tdefault = current\n' +
      '[worktree]\n\tuseRelativePaths = true\n'});
    result = await asb(['doctor']);
    // relative paths in the sandbox, but the repos can't use them yet
    expect(result.stdout).toMatch(
      /! the sandbox uses relative worktrees, but these repos/);

    for(const repo of ['a', 'b']) {
      await writeFiles(ws, {[`${repo}/.git/config`]: '[core]\n' +
        '\trepositoryformatversion = 1\n' +
        '[extensions]\n\trelativeWorktrees = true\n'});
    }
    await writeFiles(t.home, {'.gitconfig-host':
      '[worktree]\n\tuseRelativePaths = true\n'});
    result = await asb(['doctor']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/✓ relative worktrees are set up/);
    expect(result.stdout).toMatch(/No problems found\./);
  });

  it('suggests repairing worktree links made on the other side',
    async () => {
      await writeFiles(ws, {
        'a/.git/worktrees/sb/gitdir':
          '/home/agent/workspace/a/.claude/worktrees/sb/.git\n',
        'a/.git/worktrees/host/gitdir': `${ws}/a/.wt/host/.git\n`,
        'a/.wt/host/.git': `gitdir: ${ws}/a/.git/worktrees/host\n`,
        'b/.git/worktrees/rel/gitdir': '../../../.wt/rel/.git\n'
      });
      const result = await asb(['doctor', 'w']);
      expect(result.stdout).toMatch(/! worktrees made in the sandbox link/);
      expect(result.stdout).toContain(`$ git -C ${ws}/a worktree repair ` +
        `--relative-paths ${ws}/a/.claude/worktrees/sb`);
      expect(result.stdout).toMatch(/• worktrees made on the host link/);
      expect(result.stdout).not.toMatch(/ws\/b worktree repair/);
    });

  it('only warns about relative worktrees with an old git', async () => {
    let result = await asb(['doctor'], {FAKE_GIT_VERSION: '2.43.0'});
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(
      /! git 2\.43\.0: relative worktree paths need git 2\.48 or later/);
    expect(result.stdout).toMatch(/branch\.autoSetupMerge false/);
    expect(result.stdout).not.toMatch(/relativeWorktrees|useRelativePaths/);

    await writeFiles(ws, {'a/.git/config':
      '[extensions]\n\trelativeWorktrees = true\n'});
    result = await asb(['doctor'], {FAKE_GIT_VERSION: '2.43.0'});
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/✗ git 2\.43\.0 can't use repos with/);
  });

  it('reports missing paths, unsafe mounts, and unbuilt images', async () => {
    await writeFiles(t.configDir, {
      'sandboxes/bad.yaml': 'workspace: ~/missing\nimage: base\n' +
        'mounts: [~/nope:/nope, "~:/h"]\n'
    });
    const result = await asb(['doctor', 'bad']);
    expect(result.code).toBe(1);
    expect(result.stdout).not.toMatch(/Sandbox w/);
    expect(result.stdout).toMatch(/✗ workspace ~\/missing does not exist/);
    expect(result.stdout).toMatch(/✗ mounts\[0\] ~\/nope does not exist/);
    expect(result.stdout).toMatch(/✗ Unsafe mounts in sandbox "bad"/);
    expect(result.stdout).toMatch(/! image base \(asb-base\) is not built/);
    expect(result.stdout).toMatch(/\$ asb build base/);
  });

  it('reports a sandbox with broken settings and keeps going', async () => {
    await writeFiles(t.configDir, {'sandboxes/bad.yaml': 'image: nope\n'});
    const result = await asb(['doctor']);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/Sandbox bad\n {2}✗ sandbox "bad" image/);
    expect(result.stdout).toMatch(/Sandbox w\n {2}✓ workspace/);
  });

  it('reports an invalid config file', async () => {
    await writeFiles(t.configDir, {'config.yaml': 'version: 1\nbogus: 1\n'});
    const result = await asb(['doctor']);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/✗ Invalid "\S+\/config\/config\.yaml"/);
    expect(result.stdout).toMatch(/unknown property "bogus"/);
  });

  it('reports docker problems and a missing git', async () => {
    await t.setExit(1);
    await writeFiles(t.configDir, {'config.yaml':
      'version: 1\nsettings: {docker: /nonexistent/docker, ' +
      'git: /nonexistent/git}\n'});
    const result = await asb(['doctor']);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/✗ Command not found: \/nonexistent\/dock/);
    expect(result.stdout).toMatch(/! Command not found: \/nonexistent\/git/);
  });

  it('prints JSON', async () => {
    const result = await asb(['doctor', '--json']);
    const checks = JSON.parse(result.stdout);
    expect(checks[0]).toEqual({section: 'setup', level: 'ok',
      message: expect.stringMatching(/^config /), details: [], fix: []});
    expect(checks.some(c => c.section === 'sandbox w')).toBe(true);
  });

  it('refuses unknown sandboxes', async () => {
    const result = await asb(['doctor', 'nope']);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/Unknown sandbox "nope"/);
  });

  it('changes nothing', async () => {
    const home = path.join(t.dir, 'data/asb/homes/w');
    await asb(['doctor']);
    await expect(fs.stat(home)).rejects.toThrow();
    expect((await t.calls()).map(args => args[0]))
      .toEqual(['version', 'image']);
  });
});
