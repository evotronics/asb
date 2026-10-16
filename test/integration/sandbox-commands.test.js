import {beforeEach, describe, expect, it} from 'vitest';
import {createEnv, run, writeFiles} from '../helpers/fixtures.js';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('sandbox commands', () => {
  let t;

  beforeEach(async () => {
    t = await createEnv({files: {'src/lib/README.md': ''}});
  });

  const asb = (argv, {cwd = t.home, env = {}} = {}) =>
    run(argv, {cwd, env: {...t.env, ...env}});
  const sandboxFile = name =>
    path.join(t.configDir, 'sandboxes', `${name}.yaml`);

  it('creates a sandbox', async () => {
    let result = await asb(['-n', 'new', 'widget', '-w', 'ws/widget',
      '-m', 'src/lib:lib:ro', '-p', '9323', '-p', '8080:80',
      '-d', 'Widget work']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/would create ~\/\.config|would create \//);
    expect(result.stdout).toMatch(/\+workspace: ~\/ws\/widget/);
    expect(result.stdout).toMatch(/would create directory ~\/ws\/widget/);
    await expect(fs.access(sandboxFile('widget'))).rejects.toThrow();

    result = await asb(['new', 'widget', '-w', 'ws/widget',
      '-m', 'src/lib:lib:ro', '-p', '9323', '-p', '8080:80',
      '-d', 'Widget work']);
    expect(result.code).toBe(0);
    const text = await fs.readFile(sandboxFile('widget'), 'utf8');
    const expected = [
      '# asb sandbox "widget". Show the resolved settings with: asb show ' +
        'widget',
      '',
      'description: Widget work',
      'workspace: ~/ws/widget',
      'mounts:',
      '  - ~/src/lib:lib:ro',
      'ports:',
      '  - 9323',
      '  - 8080:80',
      '',
      '# Other settings include:',
      '# image: default       # or base, playwright, or one of yours',
      ''
    ].join('\n');
    expect(text.slice(0, expected.length)).toBe(expected);
    expect(result.stdout).toMatch(/created directory ~\/ws\/widget/);
    expect(result.stdout).toMatch(/created directory .*homes\/widget/);

    result = await asb(['new', 'widget']);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/already exists/);

    result = await asb(['new', 'Bad']);
    expect(result.stderr).toMatch(/Invalid sandbox name/);

    result = await asb(['new', 'x', '--image', 'nope']);
    expect(result.stderr).toMatch(/unknown image "nope"/);
    await expect(fs.access(sandboxFile('x'))).rejects.toThrow();

    result = await asb(['new', 'y', '-m', 'nocolon']);
    expect(result.stderr).toMatch(/Invalid --mount/);
  });

  it('lists and shows sandboxes', async () => {
    let result = await asb(['ls']);
    expect(result.stdout).toMatch(/No sandboxes/);

    await asb(['new', 'widget', '-w', 'ws/widget', '-d', 'Widget work']);
    await asb(['new', 'scratch']);
    await writeFiles(t.home, {'ws/widget/.mpm/config.yaml': ''});
    await t.setContainers([
      {name: 'asb-widget', sandbox: 'widget', state: 'running'},
      {name: 'asb-scratch-run-abc123', sandbox: 'scratch', state: 'running'}
    ]);
    result = await asb(['ls']);
    expect(result.code).toBe(0);
    expect(result.stdout.split('\n').map(l => l.replace(/ +/g, ' '))).toEqual([
      'NAME STATE IMAGE WORKSPACE DESCRIPTION',
      'scratch stopped +1 run default -',
      'widget running default ~/ws/widget Widget work',
      ''
    ]);
    result = await asb(['ls', '--json']);
    expect(JSON.parse(result.stdout)[1]).toMatchObject({
      name: 'widget', state: 'running', image: 'default',
      workspace: path.join(t.home, 'ws', 'widget')
    });

    result = await asb(['show', 'widget']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(
      /^workspace: ~\/ws\/widget -> \/home\/agent\/workspace$/m);
    expect(result.stdout).toMatch(/^protected:\n {2}- \.mpm$/m);

    result = await asb(['show', '--json'],
      {cwd: path.join(t.home, 'ws', 'widget')});
    expect(JSON.parse(result.stdout)).toMatchObject(
      {name: 'widget', container: 'asb-widget', protected: ['.mpm']});

    result = await asb(['show', 'widget', '--docker']);
    expect(result.stdout).toMatch(/fake-docker\.js run \\\n {2}-itd \\\n/);
    expect(result.stdout)
      .toMatch(/--mount type=bind,source=.*\.mpm,.*,readonly/);
  });

  it('shows broken sandboxes in the list', async () => {
    await writeFiles(t.configDir, {'sandboxes/bad.yaml': 'image: nope\n'});
    const result = await asb(['ls']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/bad +invalid .*unknown image "nope"/);
  });

  it('removes a sandbox but keeps its home', async () => {
    await asb(['new', 'widget']);
    await t.setContainers([{name: 'asb-widget', state: 'running'}]);
    let result = await asb(['rm', 'widget']);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/is running/);

    await t.setContainers([]);
    result = await asb(['rm', 'widget']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/deleted .*widget\.yaml\nkept home/);
    await expect(fs.access(sandboxFile('widget'))).rejects.toThrow();
  });

  it('edits and validates sandbox files', async () => {
    await asb(['new', 'widget']);
    const script = path.join(t.dir, 'editor.sh');
    await fs.writeFile(script, 'echo "$EDIT_TEXT" >> "$1"\n');
    // the editor command may include arguments
    const editor = `sh ${script}`;
    let result = await asb(['edit', 'widget'],
      {env: {EDITOR: editor, EDIT_TEXT: 'network: none'}});
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/widget\.yaml is valid/);

    result = await asb(['edit', 'widget'],
      {env: {EDITOR: editor, EDIT_TEXT: 'bogus: 1'}});
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/unknown property "bogus"/);

    result = await asb(['-n', 'edit', '-s', 'widget'],
      {env: {EDITOR: editor}});
    expect(result.stderr).toMatch(/would run: .*editor\.sh/);
  });
});

describe('config command', () => {
  let t;

  beforeEach(async () => {
    t = await createEnv();
  });

  const asb = (argv, {env = {}} = {}) =>
    run(argv, {cwd: t.home, env: {...t.env, ...env}});

  it('gets values with origins', async () => {
    let result = await asb(['config', 'get', 'user']);
    expect(result.stdout).toBe('agent\n');
    result = await asb(['config', 'get', '--show-origin']);
    expect(result.stdout).toMatch(/^user: agent {2}\(default\)$/m);
    expect(result.stdout)
      .toMatch(/^docker: .*fake-docker\.js {2}\(.*config\.yaml\)$/m);
    result = await asb(['config', 'get', 'nope']);
    expect(result.code).toBe(2);
  });

  it('sets and unsets values, keeping comments', async () => {
    const file = path.join(t.configDir, 'config.yaml');
    await fs.appendFile(file, '# my comment\n');
    let result = await asb(['config', 'set', 'defaults.resources.memory',
      '8g']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/updated .*config\.yaml/);
    let text = await fs.readFile(file, 'utf8');
    expect(text).toMatch(/# my comment/);
    expect(text).toMatch(/defaults:\n {2}resources:\n {4}memory: 8g/);

    result = await asb(['config', 'set', 'uid', 'abc']);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/\/settings\/uid: must be integer/);

    result = await asb(['config', 'set', 'defaults.ports', '[9323, 5173]']);
    expect(result.code).toBe(0);
    result = await asb(['config', 'get', 'defaults.ports', '--json']);
    expect(JSON.parse(result.stdout)).toEqual([9323, 5173]);

    result = await asb(['-n', 'config', 'unset', 'defaults']);
    expect(result.stdout).toMatch(/would update/);
    await asb(['config', 'unset', 'defaults']);
    text = await fs.readFile(file, 'utf8');
    expect(text).not.toMatch(/defaults/);
    result = await asb(['config', 'unset', 'defaults']);
    expect(result.stderr).toMatch(/is not set/);
  });

  it('prints the path, validates, and edits', async () => {
    let result = await asb(['config', 'path']);
    expect(result.stdout).toBe(`${t.configDir}\n`);
    result = await asb(['config', 'validate']);
    expect(result.stdout).toMatch(/is valid \(0 sandboxes\)/);

    await fs.rm(path.join(t.configDir, 'config.yaml'));
    result = await asb(['config', 'edit'], {env: {EDITOR: 'true'}});
    expect(result.code).toBe(0);
    expect(await fs.readFile(path.join(t.configDir, 'config.yaml'), 'utf8'))
      .toMatch(/^version: 1$/m);
  });
});
