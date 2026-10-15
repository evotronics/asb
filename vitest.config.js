import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./test/helpers/setup.js'],
    testTimeout: 30000
  }
});
