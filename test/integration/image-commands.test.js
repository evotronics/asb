import {beforeEach, describe, expect, it} from 'vitest';
import {createEnv, run, writeFiles} from '../helpers/fixtures.js';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('image commands', () => {
  let t;

  beforeEach(async () => {
    t = await createEnv({sandboxes: {widget: 'workspace: ~/ws\n'}});
    await fs.mkdir(path.join(t.home, 'ws'));
  });

  const asb = (argv, {cwd = t.home, env = {}} = {}) =>
    run(argv, {cwd, env: {...t.env, ...env}});
  const imagesDir = () => path.join(t.configDir, 'images');
  const read = file => fs.readFile(path.join(imagesDir(), file), 'utf8');

  it('lists images', async () => {
    await t.setImages(['asb-base:latest', 'ubuntu:24.04']);
    await writeFiles(imagesDir(), {
      'default/Dockerfile': 'FROM asb-base\n',
      'dev/Dockerfile': 'FROM asb-default\n',
      'dev/image.yaml': 'description: Mine\n',
      'broken/image.yaml': ''
    });
    let result = await asb(['image', 'ls']);
    expect(result.code).toBe(0);
    const lines = result.stdout.split('\n').map(l => l.replace(/ +/g, ' '));
    expect(lines[0]).toBe('NAME SOURCE BUILT FROM DESCRIPTION');
    expect(lines).toContain(
      'base built-in yes - Ubuntu with git, curl, ssh, and your user; for ' +
      'lightweight runs');
    expect(lines).toContain('default yours (replaces built-in) no base');
    expect(lines).toContain('dev yours no default Mine');
    expect(lines.find(l => l.startsWith('broken')))
      .toMatch(/no - Image "broken" has no Dockerfile/);

    result = await asb(['image', 'ls', '--json']);
    const data = JSON.parse(result.stdout);
    expect(data.find(i => i.name === 'playwright')).toMatchObject({
      source: 'built-in', tag: 'asb-playwright', built: false,
      bases: ['default']
    });
  });

  it('creates an image built FROM another', async () => {
    let result = await asb(['-n', 'image', 'new', 'dev']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/would create .*images\/dev\/Dockerfile/);
    await expect(fs.access(path.join(imagesDir(), 'dev'))).rejects.toThrow();

    result = await asb(['image', 'new', 'dev', '-d', 'My tools']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/Edit .*Dockerfile, then: asb build dev/);
    expect(await read('dev/Dockerfile')).toMatch(/^FROM asb-default$/m);
    const stub = await read('dev/Dockerfile');
    expect(stub).toMatch(/^# syntax=docker\/dockerfile:1\n/);
    expect(stub).toMatch(
      /^# RUN --mount=type=cache,target=\/var\/cache\/apt,sharing=locked/m);
    expect(stub).toMatch(/^# {5}npm install -g --prefix \/usr\/local /m);
    expect(await read('dev/image.yaml')).toBe('description: My tools\n');

    await asb(['image', 'new', 'tiny', '--from', 'base']);
    expect(await read('tiny/Dockerfile')).toMatch(/^FROM asb-base$/m);

    // the new images work with asb build
    await asb(['build', 'dev']);
    const tags = (await t.calls()).filter(c => c[0] === 'build')
      .map(c => c[c.indexOf('--tag') + 1]);
    expect(tags).toEqual(['asb-base', 'asb-default', 'asb-dev']);

    result = await asb(['image', 'new', 'dev']);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/already exists/);
    result = await asb(['image', 'new', 'x', '--from', 'nope']);
    expect(result.stderr).toMatch(/Unknown image "nope"/);
    result = await asb(['image', 'new', 'Bad']);
    expect(result.stderr).toMatch(/Invalid image name/);
    result = await asb(['image', 'new', 'x', '--from', 'base',
      '--copy', 'base']);
    expect(result.code).toBe(2);
  });

  it('copies an image', async () => {
    await writeFiles(imagesDir(), {
      'proj/docker/Dev': 'FROM ubuntu:24.04\nCOPY setup.sh /\n',
      'proj/setup.sh': 'echo hi\n',
      'proj/image.yaml': 'dockerfile: docker/Dev\ntag: me/proj\n' +
        'args: {A: 1}\n',
      'ext/image.yaml': 'context: ~/src/ext\n'
    });
    let result = await asb(['image', 'new', 'mine', '--copy', 'default']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/created .*images\/mine\/Dockerfile/);
    expect(await read('mine/Dockerfile')).toMatch(/^FROM asb-base$/m);
    expect(await read('mine/image.yaml')).toMatch(
      /^description: "copy of default: base plus development tools/);

    result = await asb(['image', 'new', 'proj2', '--copy', 'proj']);
    expect(result.code).toBe(0);
    expect(await read('proj2/setup.sh')).toBe('echo hi\n');
    expect(await read('proj2/image.yaml')).toBe(
      'description: copy of proj\ndockerfile: docker/Dev\nargs:\n  A: 1\n');
    result = await asb(['image', 'show', 'proj2', '--json']);
    expect(JSON.parse(result.stdout)).toMatchObject(
      {tag: 'asb-proj2', context: path.join(imagesDir(), 'proj2')});

    // a context outside the image directory could be a whole project
    result = await asb(['image', 'new', 'ext2', '--copy', 'ext']);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/builds from ~\/src\/ext, outside its/);
  });

  it('rejects images with the same tag', async () => {
    await writeFiles(imagesDir(), {
      'mine/Dockerfile': 'FROM asb-base\n',
      'mine/image.yaml': 'tag: asb-default:latest\n'
    });
    const result = await asb(['image', 'ls']);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(
      /Images "default" and "mine" have the same tag/);
  });

  it('shows an image', async () => {
    let result = await asb(['image', 'show', 'playwright']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^source: built-in$/m);
    expect(result.stdout).toMatch(/^tag: asb-playwright$/m);
    expect(result.stdout).toMatch(/^from:\n {2}- base\n {2}- default$/m);

    // the current sandbox's image
    result = await asb(['image', 'show', '--json'],
      {cwd: path.join(t.home, 'ws')});
    expect(JSON.parse(result.stdout)).toMatchObject(
      {name: 'default', from: ['base']});
  });
});
