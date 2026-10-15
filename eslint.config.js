import config from '@digitalbazaar/eslint-config/node-recommended';

export default [
  ...config,
  {
    ignores: ['tmp/']
  },
  {
    rules: {
      'sort-imports': 'off'
    }
  }
];
