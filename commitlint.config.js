/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      ['api', 'web', 'admin', 'ui', 'contracts', 'config', 'db', 'docs', 'ci', 'deps', 'repo'],
    ],
    'subject-case': [2, 'never', ['upper-case', 'pascal-case', 'start-case']],
    'body-max-line-length': [0],
  },
};
