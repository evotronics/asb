import {beforeEach, describe, expect, it} from 'vitest';
import {createEnv, run, writeFiles} from '../helpers/fixtures.js';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('mount safety', () => {
  let t;

  beforeEach(async () => {
    t = await createEnv({
      files: {'src/fixtures/a.txt': '', 'secret/key': '', 'ws/README': ''}
    });
  });

  const asb = (argv, {env = {}} = {}) =>
    run(argv, {cwd: t.home, env: {...t.env, ...env}});
  const sandbox = (name, text) => writeFiles(t.configDir,
    {[`sandboxes/${name}.yaml`]: text});

  it('refuses writable mounts of the home, config, or data directory',
    async () => {
      await sandbox('home', 'workspace: "~"\n');
      let result = await asb(['start', 'home']);
      expect(result.code).toBe(2);
      expect(result.stderr).toMatch(/Unsafe mounts in sandbox "home"/);
      expect(result.stderr).toMatch(/workspace ~ contains your home/);

      await sandbox('config', `workspace: ${t.dir}\n`);
      result = await asb(['start', 'config']);
      expect(result.stderr).toMatch(/contains the asb config directory/);
      expect(result.stderr).toMatch(/contains the asb data directory/);

      await sandbox('images', `mounts: ["${t.configDir}/sandboxes:/x"]\n`);
      result = await asb(['-n', 'start', 'images']);
      expect(result.code).toBe(2);
      expect(result.stderr).toMatch(/mounts\[0\] .* is inside asb's own/);

      // read-only is fine, and so is the default home in the data directory
      await sandbox('images', `mounts: ["${t.configDir}/sandboxes:/x:ro"]\n`);
      result = await asb(['-n', 'start', 'images']);
      expect(result.code).toBe(0);
    });

  it('refuses mount sources through symlinks a sandbox could plant',
    async () => {
      await sandbox('a', 'workspace: ~/src\n');
      await sandbox('b', 'workspace: ~/ws\nmounts: [~/src/fixtures:fix]\n');
      expect((await asb(['-n', 'start', 'b'])).code).toBe(0);

      // sandbox a replaces the directory b mounts with a link to a secret
      await fs.rm(path.join(t.home, 'src', 'fixtures'), {recursive: true});
      await fs.symlink(path.join(t.home, 'secret'),
        path.join(t.home, 'src', 'fixtures'));
      const result = await asb(['-n', 'start', 'b']);
      expect(result.code).toBe(2);
      expect(result.stderr).toMatch(
        /goes through the symlink ~\/src\/fixtures, inside sandbox "a"'s/);

      // a symlink you made outside every sandbox is fine
      await fs.symlink(path.join(t.home, 'ws'), path.join(t.home, 'ws-link'));
      await sandbox('c', 'workspace: ~/ws-link\n');
      expect((await asb(['-n', 'start', 'c'])).code).toBe(0);
    });

  it('refuses to start when a protected path is a symlink', async () => {
    await writeFiles(t.home, {'ws/repo/.git/config': ''});
    await fs.symlink(path.join(t.home, 'secret'),
      path.join(t.home, 'ws', 'repo', '.git', 'hooks'));
    await sandbox('w', 'workspace: ~/ws\n');
    let result = await asb(['-n', 'start', 'w']);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/can't be protected/);
    expect(result.stderr).toMatch(/repo\/\.git\/hooks is a symlink/);

    // unless it's taken out of the protect list
    await sandbox('w', 'workspace: ~/ws\nprotect: [.mpm, "*/.git/config"]\n');
    result = await asb(['-n', 'start', 'w']);
    expect(result.code).toBe(0);
  });

  it('refuses to run sandboxes as root', async () => {
    await fs.appendFile(path.join(t.configDir, 'config.yaml'), '  uid: 0\n');
    await sandbox('x', '');
    let result = await asb(['start', 'x']);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/do not run as root/);
    result = await asb(['build']);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/do not run as root/);
  });

  it('warns about build contexts a sandbox can change', async () => {
    await sandbox('a', 'workspace: ~/src\n');
    await writeFiles(t.home, {'src/proj/Dockerfile': 'FROM ubuntu:26.04\n'});
    await writeFiles(t.configDir,
      {'images/proj/image.yaml': 'context: ~/src/proj\n'});
    const result = await asb(['build', 'proj']);
    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(
      /image proj's build context ~\/src\/proj is in sandbox "a"'s/);
  });
});
