#!/usr/bin/env node
import { gzipSync } from 'node:zlib';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The bundle budget, as a number that fails rather than a number in a document.
 *
 * `PLAN.md` puts the storefront's main bundle under 250 KB gzip. That has been true since Phase 5
 * and nothing checked it, which means it was true by luck rather than by construction - one
 * unguarded `import` of a charting library at the top of a route file would have taken it past the
 * line silently, and the next person to notice would have been a customer on a phone.
 *
 * What is measured is the entry chunk and everything the browser must fetch before the first route
 * renders: the entry itself plus the modules it statically imports. A route's own chunk is not
 * counted, because route splitting is exactly the thing that keeps it out of the first load.
 *
 * gzip rather than brotli: it is the floor every browser and every proxy supports, so it is the
 * worst case a real visitor pays.
 */

const BUDGETS = [
  { app: 'web', dir: 'apps/web/dist', limitKb: 250 },
  // The back office is not on anybody's phone over a hotel connection, and it carries a form
  // library's worth of screens. A budget it can actually hold is still worth having: without one,
  // "the admin is a bit slow" has no threshold to have crossed.
  { app: 'admin', dir: 'apps/admin/dist', limitKb: 320 },
];

/**
 * The entry chunk, as the built `index.html` names it.
 *
 * The src carries the app's public base - the back office is served under `/admin`, so its tag
 * reads `/admin/assets/index-*.js` while the file sits at `assets/index-*.js` on disk. Taking the
 * path from `assets/` onwards is what makes the two apps readable by one function.
 */
function entryChunk(dir) {
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const match = /<script[^>]+src="([^"]+\.js)"/.exec(html);
  if (!match) throw new Error(`No entry script in ${dir}/index.html`);
  const fromAssets = /assets\/[^"']+$/.exec(match[1]);
  return fromAssets ? fromAssets[0] : match[1].replace(/^\//, '');
}

/**
 * Everything the entry pulls in eagerly.
 *
 * Vite rewrites static imports to relative paths inside the chunk, so following them is a matter of
 * reading the import specifiers out of the file. A dynamic import - what `lazyRouteComponent`
 * produces - appears as `import(...)` and is deliberately not followed.
 */
function eagerGraph(dir, entry) {
  const seen = new Set();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);

    const source = readFileSync(join(dir, file), 'utf8');
    // `from "./chunk-abc.js"` and `import "./chunk-abc.js"`, but never `import("./route.js")`.
    for (const match of source.matchAll(/(?:from|import)\s*["'](\.\/[^"']+\.js)["']/g)) {
      const resolved = `assets/${match[1].replace(/^\.\//, '')}`;
      if (!seen.has(resolved)) queue.push(resolved);
    }
  }

  return [...seen];
}

const gzipKb = (path) => gzipSync(readFileSync(path)).length / 1024;

let failed = false;

for (const budget of BUDGETS) {
  let files;
  try {
    files = eagerGraph(budget.dir, entryChunk(budget.dir));
  } catch (error) {
    console.error(`${budget.app}: could not read the build. Run \`pnpm build\` first.`);
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    failed = true;
    continue;
  }

  const total = files.reduce((sum, file) => sum + gzipKb(join(budget.dir, file)), 0);
  const headroom = budget.limitKb - total;
  const verdict = headroom >= 0 ? 'ok' : 'OVER';

  console.log(
    `${budget.app.padEnd(6)} ${total.toFixed(1).padStart(7)} KB gzip  /  ${String(budget.limitKb)} KB` +
      `  (${headroom >= 0 ? '' : '+'}${Math.abs(headroom).toFixed(1)} KB ${headroom >= 0 ? 'to spare' : 'over'})  ${verdict}`,
  );

  // The chunks that make up the first load, largest first - so a failure names the thing to look
  // at rather than only the total.
  if (headroom < 0) {
    for (const file of files
      .map((file) => ({ file, kb: gzipKb(join(budget.dir, file)) }))
      .sort((left, right) => right.kb - left.kb)
      .slice(0, 5)) {
      console.log(`         ${file.kb.toFixed(1).padStart(7)} KB  ${file.file}`);
    }
    failed = true;
  }
}

// Nothing is asserted about a directory that does not exist beyond the read failing above; a
// silent pass on a missing build would be the worst outcome this script could have.
if (!statSync('apps/web/dist', { throwIfNoEntry: false })) failed = true;

process.exit(failed ? 1 : 0);
