import {describe, expect, it} from 'vitest';
import {tempDir, writeFiles} from '../helpers/fixtures.js';
import {DEFAULT_PROTECT} from '../../lib/sandbox/resolve.js';
import {expandProtect} from '../../lib/sandbox/protect.js';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('expandProtect', () => {
  it('expands patterns to existing paths', async () => {
    const ws = await tempDir();
    await writeFiles(ws, {
      '.mpm/config.yaml': '',
      'a/.git/config': '',
      'a/.git/hooks/pre-commit': '',
      'a/.git/modules/sub/config': '',
      'a/.git/modules/sub/hooks/post-checkout': '',
      'b/.git/config': '',
      // a worktree or submodule checkout
      'wt/.git': 'gitdir: ../a/.git/worktrees/wt\n',
      'c/README.md': '',
      '.hidden/.git/config': '',
      file: ''
    });
    await fs.symlink('/tmp', path.join(ws, 'linked'));
    await fs.mkdir(path.join(ws, 'd', '.git'), {recursive: true});
    await fs.symlink('/tmp', path.join(ws, 'd', '.git', 'hooks'));

    expect(await expandProtect(ws, DEFAULT_PROTECT)).toEqual({
      paths: [
        '.mpm',
        'a/.git/config',
        'a/.git/hooks',
        'a/.git/modules/sub/config',
        'a/.git/modules/sub/hooks',
        'b/.git/config',
        'wt/.git'
      ],
      symlinks: ['d/.git/hooks'],
      hardLinks: []
    });
    expect(await expandProtect(ws, ['./c//README.md', 'missing/x']))
      .toEqual({paths: ['c/README.md'], symlinks: [], hardLinks: []});
  });

  it('reports protected files with other hard links', async () => {
    const ws = await tempDir();
    await writeFiles(ws, {
      'a/.git/config': '',
      'a/.git/hooks/pre-commit': '',
      'other/x': ''
    });
    await fs.link(path.join(ws, 'a', '.git', 'hooks', 'pre-commit'),
      path.join(ws, 'other', 'hook'));
    expect((await expandProtect(ws, DEFAULT_PROTECT)).hardLinks)
      .toEqual(['a/.git/hooks/pre-commit']);
  });
});
