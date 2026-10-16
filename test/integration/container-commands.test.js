import {beforeEach, describe, expect, it} from 'vitest';
import {createEnv, run, writeFiles} from '../helpers/fixtures.js';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('container commands', () => {
  let t;

  beforeEach(async () => {
    t = await createEnv({
      sandboxes: {
        widget: 'workspace: ~/ws/widget\nports: [9323]\n',
        other: 'workspace: ~/ws/other\nhome: ~/homes/other\n'
      },
      files: {
        'ws/widget/.mpm/config.yaml': '',
        'ws/widget/repo/.git/config': '',
        'ws/widget/repo/src/index.js': '',
        'ws/other/README.md': ''
      }
    });
  });

  const asb = (argv, {cwd = t.home, env = {}} = {}) =>
    run(argv, {cwd, env: {...t.env, ...env}});
  const flag = (args, name) => args[args.indexOf(name) + 1];
  const mounts = args => args.flatMap((a, i) =>
    args[i - 1] === '--mount' ? [a] : []);

  it('starts the sandbox for the current directory', async () => {
    const cwd = path.join(t.home, 'ws', 'widget', 'repo');
    const result = await asb(['start'], {cwd});
    expect(result.stderr).toMatch(/created home directory/);
    expect(result.stderr).toMatch(/started asb-widget/);
    expect(result.code).toBe(0);
    const calls = await t.calls();
    expect(calls[0]).toEqual(['ps', '--quiet', '--filter',
      'name=^asb-widget$']);
    const args = calls[1];
    expect(args.slice(0, 5)).toEqual(
      ['run', '-itd', '--rm', '--name', 'asb-widget']);
    expect(flag(args, '--publish')).toBe('9323:9323');
    const ws = path.join(t.home, 'ws', 'widget');
    expect(mounts(args)).toEqual([
      `type=bind,source=${t.dir}/data/asb/homes/widget,target=/home/agent`,
      `type=bind,source=${ws},target=/home/agent/workspace`,
      `type=bind,source=${ws}/.mpm,target=/home/agent/workspace/.mpm,` +
        'readonly',
      `type=bind,source=${ws}/repo/.git/config,` +
        'target=/home/agent/workspace/repo/.git/config,readonly'
    ]);
    expect(args.at(-1)).toBe('asb-default');
    expect((await fs.stat(path.join(t.dir, 'data', 'asb', 'homes',
      'widget'))).isDirectory()).toBe(true);
  });

  it('prints commands in dry run mode without docker', async () => {
    const result = await asb(['-n', 'start', 'widget'],
      {env: {}});
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^\+ \S*fake-docker\.js run -itd --rm /);
    expect(result.stderr).toMatch(/would create home directory/);
    expect(await t.calls()).toEqual([]);
  });

  it('refuses to start twice and checks paths', async () => {
    await t.setContainers([{name: 'asb-widget', state: 'running'}]);
    let result = await asb(['start', 'widget']);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/"widget" is already running/);

    result = await asb(['start', 'other']);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/Home directory of sandbox "other" does not/);

    result = await asb(['start']);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/not in one/);

    result = await asb(['-s', 'other', 'start', 'widget']);
    expect(result.stderr).toMatch(/given as an argument and "other" with -s/);
  });

  it('runs a shell in the current directory', async () => {
    let result = await asb(['sh', '-s', 'widget']);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/not running \(start it with/);

    await t.setContainers([{name: 'asb-widget', state: 'running'}]);
    const cwd = path.join(t.home, 'ws', 'widget', 'repo', 'src');
    result = await asb(['sh', 'ls', '-la'], {cwd});
    expect(result.code).toBe(0);
    expect((await t.calls()).at(-1)).toEqual(['exec', '-i', '--workdir',
      '/home/agent/workspace/repo/src', 'asb-widget', 'ls', '-la']);

    await asb(['--sandbox', 'widget', 'shell']);
    expect((await t.calls()).at(-1)).toEqual(['exec', '-i', '--workdir',
      '/home/agent/workspace', 'asb-widget', '/bin/bash']);
  });

  it('matches container names exactly', async () => {
    await writeFiles(t.configDir, {'sandboxes/a.b.yaml': ''});
    await t.setContainers([{name: 'asb-a-b', state: 'running'}]);
    const result = await asb(['start', 'a.b']);
    expect(result.code).toBe(0);
    expect((await t.calls())[0]).toEqual(
      ['ps', '--quiet', '--filter', 'name=^asb-a\\.b$']);
  });

  it('returns the exit code of the command', async () => {
    await t.setContainers([{name: 'asb-widget', state: 'running'}]);
    await t.setExit(3);
    const result = await asb(['-s', 'widget', 'sh', 'false']);
    expect(result.code).toBe(3);
  });

  it('runs one-shot containers', async () => {
    const cwd = path.join(t.home, 'ws', 'widget', 'repo');
    let result = await asb(['run', 'npm', '--version'], {cwd});
    expect(result.code).toBe(0);
    const args = (await t.calls()).at(-1);
    expect(args.slice(0, 4)).toEqual(['run', '-i', '--rm', '--name']);
    expect(args[4]).toMatch(/^asb-widget-run-[0-9a-f]{6}$/);
    expect(flag(args, '--workdir')).toBe('/home/agent/workspace/repo');
    expect(args.slice(-3)).toEqual(['asb-default', 'npm', '--version']);

    result = await asb(['run'], {cwd});
    expect(result.code).toBe(2);
  });

  it('stops, restarts, shows status and logs', async () => {
    await t.setContainers([{name: 'asb-widget', state: 'running'}]);
    expect((await asb(['stop', 'widget', 'other'])).code).toBe(0);
    expect((await t.calls()).at(-1))
      .toEqual(['stop', 'asb-widget', 'asb-other']);

    // restart waits for docker to remove the stopped --rm container
    await t.setContainers([{name: 'asb-widget', state: 'running'}]);
    await fs.writeFile(path.join(t.env.FAKE_DOCKER_DIR, 'remove-lag'), '2');
    expect((await asb(['restart', 'widget'])).code).toBe(0);
    const calls = await t.calls();
    expect(calls.slice(-7).map(c => c.slice(0, 2).join(' '))).toEqual([
      'ps --quiet', 'stop asb-widget',
      'ps --all', 'ps --all', 'ps --all',
      'ps --quiet', 'run -itd'
    ]);

    expect((await asb(['status', 'widget'])).code).toBe(0);
    expect((await t.calls()).at(-1)).toEqual(['ps', '--all',
      '--filter', 'label=asb.sandbox',
      '--filter', 'name=^asb-widget(-run-[0-9a-f]+)?$',
      '--format', 'table {{.Names}}\t{{.Status}}\t{{.Ports}}']);
    expect((await asb(['status', 'nope'])).code).toBe(2);

    expect((await asb(['-s', 'widget', 'logs', '-f', '--tail', '5'])).code)
      .toBe(0);
    expect((await t.calls()).at(-1))
      .toEqual(['logs', '-f', '--tail', '5', 'asb-widget']);
  });

  it('builds images', async () => {
    let result = await asb(['build', '--no-cache']);
    expect(result.code).toBe(0);
    let args = (await t.calls()).at(-1);
    expect(args).toContain('--no-cache');
    expect(flag(args, '--tag')).toBe('asb-default');
    expect(args).toContain(`USERNAME=agent`);

    result = await asb(['build', 'nope']);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/Unknown image "nope"/);

    await writeFiles(t.configDir,
      {'images/node/image.yaml': 'context: ~/img\n'});
    await writeFiles(t.home, {'img/Dockerfile': 'FROM ubuntu:24.04\n'});
    await fs.appendFile(path.join(t.configDir, 'sandboxes', 'widget.yaml'),
      'image: node\n');
    await asb(['build'], {cwd: path.join(t.home, 'ws', 'widget')});
    args = (await t.calls()).at(-1);
    expect(flag(args, '--tag')).toBe('asb-node');
    expect(args.at(-1)).toBe(path.join(t.home, 'img'));

    result = await asb(['-s', 'nope', 'build']);
    expect(result.stderr).toMatch(/Unknown sandbox "nope"/);
  });

  it('builds base images first', async () => {
    const tags = async () => (await t.calls()).filter(c => c[0] === 'build')
      .map(c => flag(c, '--tag'));
    await writeFiles(t.configDir, {
      'images/dev/Dockerfile': 'FROM asb-default\nRUN echo dev\n'
    });
    let result = await asb(['build', 'dev', 'playwright']);
    expect(result.code).toBe(0);
    expect(await tags()).toEqual(
      ['asb-base', 'asb-default', 'asb-dev', 'asb-playwright']);
    expect(result.stderr.split('\n').filter(Boolean)).toEqual([
      'asb: building asb-base (the base of default)',
      'asb: building asb-default (the base of dev)'
    ]);

    await asb(['build', '--no-bases', 'dev']);
    expect((await tags()).at(-1)).toBe('asb-dev');
    expect((await tags()).length).toBe(5);

    // a user image replaces the built-in one it is named after
    await writeFiles(t.configDir, {
      'images/default/Dockerfile': 'FROM ubuntu:24.04\n'
    });
    await asb(['build', 'dev']);
    const calls = (await t.calls()).filter(c => c[0] === 'build').slice(-2);
    expect(calls.map(c => flag(c, '--tag')))
      .toEqual(['asb-default', 'asb-dev']);
    expect(calls[0].at(-1)).toBe(path.join(t.configDir, 'images', 'default'));

    await t.setExit(1);
    result = await asb(['build', 'dev']);
    expect(result.code).toBe(1);
    expect((await tags()).length).toBe(8);
  });

  it('reports a missing docker command', async () => {
    await fs.writeFile(path.join(t.configDir, 'config.yaml'),
      'version: 1\nsettings: {docker: /nonexistent/docker}\n');
    const result = await asb(['build']);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/Command not found: \/nonexistent\/docker/);
  });
});
