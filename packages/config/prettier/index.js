/** @type {import('prettier').Config} */
export default {
  printWidth: 100,
  tabWidth: 2,
  semi: true,
  singleQuote: true,
  quoteProps: 'as-needed',
  jsxSingleQuote: false,
  trailingComma: 'all',
  bracketSpacing: true,
  bracketSameLine: false,
  arrowParens: 'always',
  endOfLine: 'lf',
  overrides: [
    {
      files: ['*.md'],
      options: { proseWrap: 'preserve' },
    },
    {
      files: ['*.yml', '*.yaml'],
      options: { singleQuote: false },
    },
  ],
};
