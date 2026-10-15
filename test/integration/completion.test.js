import {beforeEach, describe, expect, it} from 'vitest';
import {createEnv, run} from '../helpers/fixtures.js';

describe('completion', () => {
  let t;

  beforeEach(async () => {
    t = await createEnv({
      config: 'images:\n  node: {context: ~/img}\n',
      sandboxes: {
        widget: 'description: Widget work\n',
        scratch: ''
      }
    });
  });

  const words = async (...typed) => {
    const result = await run(['__complete', '--', ...typed],
      {cwd: t.home, env: t.env});
    return result.stdout.split('\n').filter(Boolean)
      .map(l => l.split('\t')[0]);
  };

  it('completes commands, options, and names', async () => {
    expect(await words('st')).toEqual(['start', 'stop', 'status']);
    expect(await words('start', '')).toEqual(['scratch', 'widget']);
    expect(await words('stop', 'widget', '')).toEqual(['scratch', 'widget']);
    expect(await words('-s', 'w')).toEqual(['widget']);
    expect(await words('sh', '--sandbox', '')).toEqual(['scratch', 'widget']);
    expect(await words('build', '')).toEqual(['default', 'node']);
    expect(await words('new', 'x', '--image', 'n')).toEqual(['node']);
    expect(await words('new', 'x', '-w', '')).toEqual(['__dirs__']);
    expect(await words('config', '')).toEqual(
      ['get', 'set', 'unset', 'path', 'validate', 'edit']);
    expect(await words('config', 'set', 'do')).toEqual(['docker']);
    expect(await words('completion', 'z')).toEqual(['zsh']);
    expect(await words('start', '--')).toContain('--sandbox');
  });

  it('leaves commands to run to the shell', async () => {
    expect(await words('sh', '')).toEqual(['__files__']);
    expect(await words('run', 'npm', '')).toEqual(['__files__']);
  });

  it('prints scripts', async () => {
    for(const shell of ['bash', 'zsh', 'fish']) {
      const result = await run(['completion', shell], {env: t.env});
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/asb __complete --/);
    }
    const result = await run(['completion', 'csh'], {env: t.env});
    expect(result.code).toBe(2);
  });
});
