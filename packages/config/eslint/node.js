import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Node service rules, scoped to the given globs. Layered on top of `baseConfig`,
 * which it deliberately does not include - the base is applied once at the repo root.
 *
 * @param {{ files: string[] }} options
 * @returns {import('typescript-eslint').ConfigArray}
 */
export function nodeBlock({ files }) {
  return tseslint.config({
    files,
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // pino is the logger; console output would bypass structured logging.
      'no-console': 'error',
    },
  });
}

export default nodeBlock;
