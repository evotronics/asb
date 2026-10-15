/**
 * Isolate tests from the user's asb configuration.
 */
import {afterAll} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {removeTempDirs} from './fixtures.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asb-env-'));
delete process.env.ASB_CONFIG_DIR;
delete process.env.ASB_SANDBOX;
// never read the developer's own ~/.config/asb or ~/.local/share/asb
process.env.XDG_CONFIG_HOME = path.join(dir, 'config');
process.env.XDG_DATA_HOME = path.join(dir, 'data');

afterAll(async () => {
  await removeTempDirs();
  fs.rmSync(dir, {recursive: true, force: true});
});
