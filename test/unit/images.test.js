import {beforeEach, describe, expect, it} from 'vitest';
import {buildOrder, fromReferences, imageBases, loadImages}
  from '../../lib/config/images.js';
import {tempDir, writeFiles} from '../helpers/fixtures.js';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('images', () => {
  let dir;
  let env;
  let builtinDir;
  let userDir;

  beforeEach(async () => {
    dir = await tempDir();
    env = {HOME: path.join(dir, 'home'), ASB_CONFIG_DIR: path.join(dir, 'c')};
    builtinDir = path.join(dir, 'builtin');
    userDir = path.join(env.ASB_CONFIG_DIR, 'images');
    await writeFiles(builtinDir, {
      'base/Dockerfile': 'FROM ubuntu:24.04\n',
      'base/image.yaml': 'description: Minimal\n',
      'default/Dockerfile': 'FROM asb-base\n',
      'playwright/Dockerfile': 'FROM asb-default:latest\n'
    });
  });

  const load = () => loadImages({env, builtinDir});

  it('loads built-in images', async () => {
    const images = await load();
    expect(Object.keys(images)).toEqual(['base', 'default', 'playwright']);
    expect(images.base).toEqual({
      name: 'base',
      source: 'built-in',
      dir: path.join(builtinDir, 'base'),
      description: 'Minimal',
      tag: 'asb-base',
      context: path.join(builtinDir, 'base'),
      dockerfile: path.join(builtinDir, 'base', 'Dockerfile'),
      args: {}
    });
  });

  it('loads user images, which replace built-ins', async () => {
    await writeFiles(userDir, {
      'default/Dockerfile': 'FROM asb-base\nRUN echo mine\n',
      'dev/Dockerfile': 'FROM asb-default\n',
      'proj/image.yaml': 'context: ~/src/proj\ndockerfile: docker/Dev\n' +
        'tag: me/proj:1\nargs: {NODE: 24}\n',
      'rel/image.yaml': 'context: ../shared\n',
      '.hidden/Dockerfile': ''
    });
    await fs.writeFile(path.join(userDir, 'README.md'), 'not an image');
    const images = await load();
    expect(Object.keys(images))
      .toEqual(['base', 'default', 'dev', 'playwright', 'proj', 'rel']);
    expect(images.default).toMatchObject(
      {source: 'user', dir: path.join(userDir, 'default')});
    expect(images.proj).toMatchObject({
      tag: 'me/proj:1',
      context: path.join(env.HOME, 'src', 'proj'),
      dockerfile: path.join(env.HOME, 'src', 'proj', 'docker', 'Dev'),
      args: {NODE: 24}
    });
    expect(images.rel.context).toBe(path.join(userDir, 'shared'));
  });

  it('reports invalid image directories and files', async () => {
    await writeFiles(userDir, {'Bad/Dockerfile': ''});
    await expect(load()).rejects.toThrow(/Invalid image directory name/);
    await fs.rm(path.join(userDir, 'Bad'), {recursive: true});
    await writeFiles(userDir, {'x/image.yaml': 'tag: UPPER\nbogus: 1\n'});
    await expect(load()).rejects.toMatchObject({details: [
      '(top level): unknown property "bogus"',
      '/tag: must be a lowercase docker image name, e.g. asb-node or ' +
        'me/node:24'
    ]});
  });

  it('parses FROM lines', () => {
    expect(fromReferences([
      '# FROM commented',
      'FROM --platform=linux/amd64 asb-base AS build',
      'from node:24',
      '  FROM ${BASE}',
      'RUN echo FROM nothing'
    ].join('\n'))).toEqual(['asb-base', 'node:24', '${BASE}']);
  });

  it('finds bases and the build order', async () => {
    await writeFiles(userDir, {
      'dev/Dockerfile': 'FROM asb-default AS tools\nFROM asb-base\n' +
        'FROM tools\n'
    });
    const images = await load();
    expect(await imageBases(images.dev, images)).toEqual(['default', 'base']);
    expect(await imageBases(images.playwright, images)).toEqual(['default']);
    expect(await buildOrder(['dev', 'playwright'], images)).toEqual([
      {name: 'base', baseOf: 'default', bases: []},
      {name: 'default', baseOf: 'dev', bases: ['base']},
      {name: 'dev', bases: ['default', 'base']},
      {name: 'playwright', bases: ['default']}
    ]);
    expect(await buildOrder(['dev'], images, {bases: false}))
      .toEqual([{name: 'dev', bases: ['default', 'base']}]);
    await expect(buildOrder(['nope'], images))
      .rejects.toThrow(/Unknown image "nope"/);
  });

  it('ships layered built-in images', async () => {
    const images = await loadImages({env});
    expect(Object.keys(images)).toEqual(['base', 'default', 'playwright']);
    expect((await buildOrder(['playwright'], images)).map(i => i.name))
      .toEqual(['base', 'default', 'playwright']);
    for(const image of Object.values(images)) {
      expect(image.description).toBeTruthy();
    }
  });

  it('reports cycles and missing Dockerfiles', async () => {
    await writeFiles(userDir, {
      'a/Dockerfile': 'FROM asb-b\n',
      'b/Dockerfile': 'FROM asb-a\n',
      'empty/image.yaml': 'description: no Dockerfile\n'
    });
    const images = await load();
    await expect(buildOrder(['a'], images))
      .rejects.toThrow(/built from each other: a -> b -> a/);
    await expect(buildOrder(['empty'], images, {bases: false}))
      .rejects.toThrow(/Image "empty" has no Dockerfile/);
  });
});
