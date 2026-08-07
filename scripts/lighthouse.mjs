#!/usr/bin/env node
/**
 * Lighthouse over the storefront's main screens, desktop and mobile.
 *
 * Phase 5's acceptance asks for a score on both form factors for every screen, which is a
 * dozen runs; done by hand it is done once and never again. Run it against the *built* bundle,
 * never the dev server - an unminified module graph measures nothing anybody will ever load:
 *
 *   pnpm --filter @silkgrain/api dev            # the preview proxies /api to :3001
 *   pnpm --filter @silkgrain/web build
 *   pnpm --filter @silkgrain/web preview        # :4173
 *   node scripts/lighthouse.mjs
 *
 * `--block-third-party` blocks the image hosts the development seed points at. That is not
 * cheating on the number: those URLs are seed fixtures seconds slow and hundreds of kilobytes
 * heavy, and blocking them separates what this codebase costs from what the fixture costs.
 * Both numbers are worth having, which is why it is a flag and not the default.
 *
 * Reporting only - deliberately not part of `pnpm verify`. Scores move a few points between
 * runs on a machine doing anything else, and a gate that fails for that reason teaches people
 * to re-run it until it passes.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const BASE = process.env.LIGHTHOUSE_BASE ?? 'http://localhost:4173';

/** The screens Phase 5 builds. A route that needs a session is not here: Lighthouse has none. */
const PAGES = [
  ['home', '/'],
  ['shop', '/shop'],
  ['category', '/shop/c/rice-grains'],
  ['product', '/product/devzira-rice'],
  ['cart', '/cart'],
  ['recipes', '/recipes'],
  ['about', '/about'],
  ['help', '/help'],
  ['wishlist', '/wishlist'],
  ['account', '/account'],
  ['404', '/no-such-page'],
];

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return undefined;
}

const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

const blockThirdParty = process.argv.includes('--block-third-party');
const chrome = findChrome();
if (!chrome) {
  console.error('No Chrome found. Set CHROME_PATH to the binary and run again.');
  process.exit(1);
}

/**
 * The CLI's entry script, run through this same Node rather than through a shell.
 *
 * `spawn(..., { shell: true })` cost an hour: the shell splits an unquoted
 * `--chrome-flags=--headless=new --no-sandbox` in two, Lighthouse reads the second half as a
 * URL, and every report comes back scoring zero rather than failing. No shell, no splitting.
 */
const require = createRequire(import.meta.url);
const lighthousePackage = require.resolve('lighthouse/package.json');
const lighthouseCli = join(dirname(lighthousePackage), 'cli', 'index.js');

function run(url, preset, outDir, index) {
  const outPath = join(outDir, `report-${String(index)}.json`);
  const args = [
    lighthouseCli,
    url,
    '--output=json',
    `--output-path=${outPath}`,
    '--quiet',
    '--chrome-flags=--headless=new --no-sandbox',
  ];
  // Mobile is Lighthouse's default; only desktop needs saying.
  if (preset === 'desktop') args.push('--preset=desktop');
  if (blockThirdParty) {
    args.push('--blocked-url-patterns=*themealdb*', '--blocked-url-patterns=*wikimedia*');
  }

  const result = spawnSync(process.execPath, args, {
    stdio: 'ignore',
    env: { ...process.env, CHROME_PATH: chrome },
  });
  if (result.error || !existsSync(outPath)) return null;

  const report = JSON.parse(readFileSync(outPath, 'utf8'));
  if (report.runtimeError) return null;
  return Object.fromEntries(
    CATEGORIES.map((key) => [key, Math.round((report.categories[key]?.score ?? 0) * 100)]),
  );
}

const outDir = mkdtempSync(join(tmpdir(), 'silkgrain-lh-'));
let index = 0;

console.log(`Lighthouse against ${BASE}${blockThirdParty ? ' (third-party images blocked)' : ''}`);
console.log('screen            form      perf  a11y   bp   seo');

try {
  for (const [name, path] of PAGES) {
    for (const preset of ['desktop', 'mobile']) {
      index += 1;
      const scores = run(`${BASE}${path}`, preset, outDir, index);
      if (!scores) {
        console.log(`${name.padEnd(17)} ${preset.padEnd(9)} failed to run`);
        continue;
      }
      const cells = CATEGORIES.map((key) => String(scores[key]).padStart(4)).join(' ');
      console.log(`${name.padEnd(17)} ${preset.padEnd(9)}${cells}`);
    }
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
