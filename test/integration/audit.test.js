import {beforeEach, describe, expect, it} from 'vitest';
import {createEnv, run, writeFiles} from '../helpers/fixtures.js';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('audit', () => {
  let t;
  let ws;

  beforeEach(async () => {
    t = await createEnv({
      sandboxes: {w: 'workspace: ~/ws\n'},
      files: {
        'ws/repo/.git/config': '[core]\n\tbare = false\n',
        'ws/repo/.git/hooks/pre-commit.sample': '#!/bin/sh\n',
        'ws/lfs/.git/config': '[filter "lfs"]\n' +
          '\tclean = git-lfs clean -- %f\n',
        'ws/other/.git/config': ''
      }
    });
    ws = path.join(t.home, 'ws');
    await fs.chmod(path.join(ws, 'repo/.git/hooks/pre-commit.sample'), 0o755);
  });

  const asb = argv => run(argv, {cwd: t.home, env: t.env});

  it('reports findings until they are accepted', async () => {
    let result = await asb(['audit', 'w']);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/No baseline yet/);
    expect(result.stdout).toMatch(
      /git config ~\/ws\/lfs\/\.git\/config: filter\.lfs\.clean = git-lfs/);
    expect(result.stdout).not.toMatch(/pre-commit\.sample/);

    result = await asb(['audit', 'w', '--accept']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/saved the baseline .*audit\/w\.json/);
    result = await asb(['audit', 'w']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/No new or changed findings/);
  });

  it('finds what a sandbox could plant for the host to run', async () => {
    await asb(['audit', 'w', '--accept']);
    await writeFiles(ws, {
      // git reads the config (and hooks) of the commondir
      'repo/.git/commondir': '../.evil\n',
      'repo/.evil/config': '[core]\n\tfsmonitor = touch /tmp/pwned\n',
      'other/.git/hooks/post-checkout': '#!/bin/sh\n',
      'wt/.git': 'gitdir: /somewhere/else\n',
      '.envrc': 'export X=1\n'
    });
    await fs.chmod(path.join(ws, 'other/.git/hooks/post-checkout'), 0o755);

    let result = await asb(['audit', 'w', '--json']);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).added.map(f => f.id)).toEqual([
      `commondir:${ws}/repo/.git/commondir`,
      `file:${ws}/.envrc`,
      `git-config:${ws}/repo/.evil/config:core.fsmonitor`,
      `gitfile:${ws}/wt/.git`,
      `hook:${ws}/other/.git/hooks/post-checkout`
    ]);

    // and says so when the sandbox stops
    await t.setContainers([{name: 'asb-w', state: 'running'}]);
    result = await asb(['stop', 'w']);
    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(/audit: 5 changes in sandbox "w"/);
    expect(result.stderr).toMatch(
      /new: git config ~\/ws\/repo\/\.evil\/config: core\.fsmonitor = touch/);
    expect(result.stderr).toMatch(/asb audit w --accept/);
  });

  it('reports changed watched files and hooks', async () => {
    await writeFiles(ws, {'.npmrc': 'a=1\n'});
    await asb(['audit', 'w', '--accept']);
    await writeFiles(ws, {'.npmrc': 'script-shell=/tmp/x\n'});
    const result = await asb(['audit', 'w']);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/Changed:\n {2}watched file ~\/ws\/\.npmrc/);
  });

  it('saves a first baseline on start', async () => {
    const result = await asb(['start', 'w']);
    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(/saved a first baseline for "w" with 1/);
    await fs.access(path.join(t.dir, 'data', 'asb', 'audit', 'w.json'));
    expect((await asb(['audit', 'w'])).code).toBe(0);
  });
});
