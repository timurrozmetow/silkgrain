import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * True when the module is the process entry point.
 *
 * Comparing `import.meta.url` to `process.argv[1]` directly does not work on Windows: one is
 * a `file:///C:/...` URL and the other a `C:\...` path, so the strings never match and the
 * script silently does nothing.
 */
export function isMain(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(fileURLToPath(metaUrl)) === path.resolve(entry);
}
