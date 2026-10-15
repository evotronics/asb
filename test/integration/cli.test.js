import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {run} from '../helpers/fixtures.js';

const pkg = JSON.parse(fs.readFileSync(
  path.join(import.meta.dirname, '..', '..', 'package.json'), 'utf8'));

describe('cli', () => {
  it('prints the version', async () => {
    const result = await run(['--version']);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`${pkg.version}\n`);
  });
});
