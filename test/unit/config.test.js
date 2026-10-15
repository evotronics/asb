import {beforeEach, describe, expect, it} from 'vitest';
import {containerPathFor, findSandboxForPath, selectSandbox}
  from '../../lib/sandbox/select.js';
import {getSandbox, mergeDefaults, normalizePort, parseMount}
  from '../../lib/sandbox/resolve.js';
import {tempDir, writeFiles} from '../helpers/fixtures.js';
import fs from 'node:fs/promises';
import {loadConfig} from '../../lib/config/load.js';
import path from 'node:path';

describe('config', () => {
  let dir;
  let env;

  beforeEach(async () => {
    dir = await tempDir();
    env = {
      HOME: path.join(dir, 'home'),
      ASB_CONFIG_DIR: path.join(dir, 'config'),
      XDG_DATA_HOME: path.join(dir, 'data')
    };
  });

  it('loads an empty config', async () => {
    const config = await loadConfig({env});
    expect(config.exists).toBe(false);
    expect(config.sandboxes).toEqual([]);
    expect(config.settings.user).toBe('agent');
    expect(config.settingOrigins.user).toBe('default');
    expect(config.images.default.tag).toBe('asb-default');
    expect(config.images.default.dockerfile)
      .toMatch(/images\/default\/Dockerfile$/);
  });

  it('applies settings, defaults, and images', async () => {
    await writeFiles(env.ASB_CONFIG_DIR, {
      'config.yaml': [
        'version: 1',
        'settings: {user: dev, uid: 1234}',
        'defaults:',
        '  resources: {cpus: 2, memory: 8g}',
        '  env: {A: "1", B: two}',
        '  ports: [9323]',
        'images:',
        '  node: {context: ~/images/node, args: {NODE: 24}}',
        ''
      ].join('\n'),
      'sandboxes/widget.yaml': [
        'description: Widget',
        'image: node',
        'workspace: ~/sandboxes/widget',
        'mounts:',
        '  - ~/src/lib:lib:ro',
        '  - {source: /data, target: /data}',
        'resources: {memory: 4g}',
        'env: {B: 2}',
        'ports: [5173-5177, "127.0.0.1:8080:80", 53/udp]',
        ''
      ].join('\n'),
      'sandboxes/notes.txt': 'ignored'
    });
    const config = await loadConfig({env});
    expect(config.settings).toMatchObject({user: 'dev', uid: 1234});
    expect(config.settingOrigins.uid).toBe(
      path.join(env.ASB_CONFIG_DIR, 'config.yaml'));
    expect(config.sandboxes.map(s => s.name)).toEqual(['widget']);

    const sandbox = getSandbox(config, 'widget');
    expect(sandbox).toMatchObject({
      name: 'widget',
      container: 'asb-widget',
      description: 'Widget',
      user: 'dev',
      uid: 1234,
      containerHome: '/home/dev',
      home: path.join(env.XDG_DATA_HOME, 'asb', 'homes', 'widget'),
      defaultHome: true,
      workspace: path.join(env.HOME, 'sandboxes', 'widget'),
      workspaceTarget: '/home/dev/workspace',
      workdir: '/home/dev/workspace',
      mounts: [
        {source: path.join(env.HOME, 'src', 'lib'), target: '/home/dev/lib',
          readonly: true},
        {source: '/data', target: '/data', readonly: false}
      ],
      ports: ['5173-5177:5173-5177', '127.0.0.1:8080:80', '53:53/udp'],
      network: 'bridge',
      resources: {cpus: 2, memory: '4g', pids: 2048},
      env: {A: '1', B: '2'},
      readonly: false,
      tmpExec: false,
      shell: '/bin/bash',
      runArgs: [],
      docker: 'docker'
    });
    expect(sandbox.image).toMatchObject({
      name: 'node',
      tag: 'asb-node',
      context: path.join(env.HOME, 'images', 'node'),
      args: {NODE: 24}
    });
    expect(sandbox.protect).toContain('*/.git/config');
  });

  it('reports invalid files', async () => {
    await writeFiles(env.ASB_CONFIG_DIR, {
      'sandboxes/bad.yaml': 'home: relative/path\nbogus: 1\n'
    });
    await expect(loadConfig({env})).rejects.toMatchObject({
      message: expect.stringMatching(/Invalid ".*bad\.yaml"/),
      details: [
        '(top level): unknown property "bogus"',
        '/home: must be an absolute path or start with "~/"'
      ]
    });
  });

  it('reports bad sandbox names, images, and duplicate targets', async () => {
    await writeFiles(env.ASB_CONFIG_DIR, {'sandboxes/Bad.yaml': ''});
    await expect(loadConfig({env})).rejects.toThrow(/Invalid sandbox file/);

    await fs.rm(path.join(env.ASB_CONFIG_DIR, 'sandboxes', 'Bad.yaml'));
    await writeFiles(env.ASB_CONFIG_DIR, {
      'sandboxes/a.yaml': 'image: nope\n',
      'sandboxes/b.yaml': 'workspace: /w\nmounts: [/x:workspace]\n'
    });
    const config = await loadConfig({env});
    expect(() => getSandbox(config, 'a')).toThrow(/unknown image "nope"/);
    expect(() => getSandbox(config, 'b'))
      .toThrow(/"\/home\/agent\/workspace" is already used by workspace/);
    expect(() => getSandbox(config, 'c')).toThrow(/Unknown sandbox "c"/);
  });

  it('validates pending changes', async () => {
    const file = path.join(env.ASB_CONFIG_DIR, 'sandboxes', 'new.yaml');
    const config = await loadConfig({
      env, overrides: new Map([[file, 'workspace: ~/w\n']])
    });
    expect(config.sandboxes.map(s => s.name)).toEqual(['new']);
  });
});

describe('sandbox selection', () => {
  let dir;
  let config;

  beforeEach(async () => {
    dir = await tempDir();
    const env = {
      HOME: path.join(dir, 'home'),
      ASB_CONFIG_DIR: path.join(dir, 'config'),
      XDG_DATA_HOME: path.join(dir, 'data')
    };
    await writeFiles(env.ASB_CONFIG_DIR, {
      'sandboxes/outer.yaml': 'workspace: ~/ws\n',
      'sandboxes/inner.yaml': 'workspace: ~/ws/inner\n' +
        'mounts: [~/shared:/shared]\n',
      'sandboxes/other.yaml': 'workspace: ~/other\n' +
        'mounts: [~/shared:/shared]\n'
    });
    await fs.mkdir(path.join(env.HOME, 'ws', 'inner', 'repo'),
      {recursive: true});
    config = await loadConfig({env});
  });

  it('uses the name, then ASB_SANDBOX, then the current directory',
    async () => {
      const home = path.join(dir, 'home');
      const select = (cwd, options = {}) => selectSandbox(config, {
        cwd, env: {}, ...options
      }).then(s => s.name);
      expect(await select(home, {name: 'other'})).toBe('other');
      expect(await select(home, {env: {ASB_SANDBOX: 'outer'}}))
        .toBe('outer');
      expect(await select(path.join(home, 'ws'))).toBe('outer');
      expect(await select(path.join(home, 'ws', 'inner', 'repo')))
        .toBe('inner');
      await expect(select(path.join(home, 'shared')))
        .rejects.toThrow(/more than one sandbox: inner, other/);
      await expect(select(home)).rejects.toThrow(/not in one/);
      expect((await findSandboxForPath(config,
        path.join(dir, 'data', 'asb', 'homes', 'other')))[0].name)
        .toBe('other');
    });

  it('maps host paths to container paths', async () => {
    const home = path.join(dir, 'home');
    const sandbox = (await selectSandbox(config,
      {name: 'inner', cwd: home, env: {}}));
    expect(await containerPathFor(sandbox,
      path.join(home, 'ws', 'inner', 'repo')))
      .toBe('/home/agent/workspace/repo');
    expect(await containerPathFor(sandbox, path.join(home, 'shared', 'x')))
      .toBe('/shared/x');
    expect(await containerPathFor(sandbox, home)).toBe(undefined);
  });
});

describe('helpers', () => {
  it('normalizes ports', () => {
    expect(normalizePort(9323)).toBe('9323:9323');
    expect(normalizePort('5173-5177')).toBe('5173-5177:5173-5177');
    expect(normalizePort('53/udp')).toBe('53:53/udp');
    expect(normalizePort('8080:80')).toBe('8080:80');
  });

  it('parses mounts', () => {
    expect(parseMount('~/a:/b')).toEqual(
      {source: '~/a', target: '/b', readonly: false});
    expect(parseMount('/a:b:ro')).toEqual(
      {source: '/a', target: 'b', readonly: true});
  });

  it('merges defaults', () => {
    expect(mergeDefaults(
      {description: 'x', ports: [1], env: {A: 1}, resources: {cpus: 1}},
      {ports: [2], env: {B: 2}}
    )).toEqual({ports: [2], env: {A: 1, B: 2}, resources: {cpus: 1}});
  });
});
