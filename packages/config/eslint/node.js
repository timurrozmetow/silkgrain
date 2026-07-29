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

      // Fastify's route-option hook types (`onRequest`, `preHandler`) default to the
      // callback overload returning `void`, even though the framework awaits a returned
      // promise and every guard in this codebase is an async function. Without this, passing
      // a perfectly correct async guard to `onRequest` is reported as a misused promise.
      // Only the property check is relaxed; arguments, returns and variables stay on.
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          checksConditionals: true,
          checksVoidReturn: {
            arguments: true,
            attributes: true,
            properties: false,
            returns: true,
            variables: true,
          },
        },
      ],
    },
  });
}

export default nodeBlock;
