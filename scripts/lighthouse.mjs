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
 * `--ci` is task 8.5's gate: the four pages `PLAN.md` names, both form factors, compared against
 * `lighthouse-budget.json` and exiting non-zero on a shortfall. `--update` rewrites that file
 * from a fresh run.
 *
 * This file used to say a gate was impossible because "scores move a few points between runs".
 * That was believed rather than measured, and measuring it disproved it: across two full matrices
 * on one build, all fourteen cells for pages whose requests stay on localhost were identical to
 * the point, and only pages fetching the public internet moved (by at most 3). So the gate blocks
 * the seed's image hosts - the same flag, for the same stated reason, "separates what this
 * codebase costs from what the fixture costs" - and what remains is deterministic enough to
 * defend a number.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const BASE = process.env.LIGHTHOUSE_BASE ?? 'http://localhost:4173';

/**
 * The screens Phase 5 builds. A route that needs a session is not here: Lighthouse has none.
 *
 * `probe` is the API resource the page cannot render without, and it is checked before a single
 * measurement runs. That check exists because the comment below it was written as a warning and
 * then ignored: the product row said `/product/devzira-rice` while the seed's slug is
 * `uzbek-devzira-rice`, so every product number this script ever printed - including the ones in
 * STATE.md that question Q-46 rests on - was the score of the "We do not stock that" empty state.
 * It scored 99 desktop and 87 mobile, the top of the table, because a page with no photograph on
 * it is the fastest page in the shop.
 *
 * That is the failure mode this whole harness is most exposed to, and it points the wrong way: a
 * broken page always scores BETTER than the page it stands in for, so the number goes up exactly
 * when something is wrong. Hence a preflight rather than a comment.
 */
const PAGES = [
  ['home', '/', '/api/products?perPage=1'],
  ['shop', '/shop', '/api/products?perPage=1'],
  // Slugs come from the development seed. A slug that does not exist renders an empty state,
  // which scores beautifully and measures nothing.
  ['category', '/shop/c/rice', '/api/categories'],
  ['product', '/product/uzbek-devzira-rice', '/api/products/uzbek-devzira-rice'],
  ['cart', '/cart', null],
  ['recipes', '/recipes', '/api/recipes'],
  ['about', '/about', null],
  ['help', '/help', '/api/faqs'],
  ['wishlist', '/wishlist', null],
  ['account', '/account', null],
  ['404', '/no-such-page', null],
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

/** Every remote host the development seed points an image at. Derived by grepping the seed. */
const THIRD_PARTY_HOSTS = ['themealdb', 'wikimedia', 'unsplash'];

/**
 * Refuses to measure a shop that is not there.
 *
 * Every page in this app renders an empty state when its data does not arrive, and an empty state
 * is fast. So an API that is down, a database that was never seeded, or a slug that was renamed
 * all make these numbers go UP, and silently. Nothing else in the script can tell the difference.
 */
async function preflight(base) {
  const problems = [];

  const root = await fetch(base).catch(() => null);
  if (!root?.ok) {
    problems.push(`${base} did not answer. Run \`pnpm --filter @silkgrain/web preview\`.`);
    return problems;
  }

  for (const [name, , probe] of PAGES) {
    if (probe === null) continue;
    const response = await fetch(`${base}${probe}`).catch(() => null);
    if (!response?.ok) {
      problems.push(
        `${name}: ${probe} answered ${response ? String(response.status) : 'nothing'}. ` +
          `The page would render an empty state and score well for the wrong reason.`,
      );
    }
  }
  return problems;
}

const ci = process.argv.includes('--ci');
const update = process.argv.includes('--update');
// The gate always blocks. A threshold on a number two remote hosts can move by three points is a
// threshold that fails for reasons nobody can act on.
const blockThirdParty = ci || update || process.argv.includes('--block-third-party');
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
    // All three, not two. `unsplash` was missing, and it is the host behind every recipe image -
    // 906 KB on /recipes, the worst mobile page in the table, which is precisely the page the
    // flag looked least able to help. It was not that the flag did not help; it was not applied.
    for (const host of THIRD_PARTY_HOSTS) args.push(`--blocked-url-patterns=*${host}*`);
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

const problems = await preflight(BASE);
if (problems.length > 0) {
  console.error('Refusing to measure - the shop is not in a state worth measuring:\n');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('\nStart the API on :3001 and seed the database, then run this again.');
  process.exit(1);
}

const BUDGET_PATH = join(
  dirname(new URL(import.meta.url).pathname.slice(1)),
  '..',
  'lighthouse-budget.json',
);

/** The four pages task 8.5 names. The reporter still walks all eleven. */
const GATED = new Set(['home', 'shop', 'product', 'cart']);

const outDir = mkdtempSync(join(tmpdir(), 'silkgrain-lh-'));
let index = 0;
let failures = 0;
const measured = {};

const scope = ci || update ? PAGES.filter(([name]) => GATED.has(name)) : PAGES;

console.log(`Lighthouse against ${BASE}${blockThirdParty ? ' (third-party images blocked)' : ''}`);
console.log('screen            form      perf  a11y   bp   seo');

try {
  for (const [name, path] of scope) {
    for (const preset of ['desktop', 'mobile']) {
      index += 1;
      // One retry. A launch can lose a race with a Chrome that has not finished exiting, and
      // that is a flaky harness rather than a slow page - retrying it is honest, re-running the
      // whole gate until it goes green is not, which is why only THIS failure gets a second go.
      const scores =
        run(`${BASE}${path}`, preset, outDir, index) ??
        run(`${BASE}${path}`, preset, outDir, index + 1000);
      if (!scores) {
        // Loudly, and it counts. A run that could not run is not a run that scored nothing, and
        // the old version printed this line and still exited 0.
        console.log(`${name.padEnd(17)} ${preset.padEnd(9)} FAILED TO RUN`);
        failures += 1;
        continue;
      }
      measured[name] ??= {};
      measured[name][preset] = scores;
      const cells = CATEGORIES.map((key) => String(scores[key]).padStart(4)).join(' ');
      console.log(`${name.padEnd(17)} ${preset.padEnd(9)}${cells}`);
    }
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(
    `\n${String(failures)} of ${String(index)} runs failed. The table above is partial.`,
  );
  process.exit(1);
}

if (update) {
  const budget = JSON.parse(readFileSync(BUDGET_PATH, 'utf8'));
  budget.pages = Object.fromEntries(
    Object.entries(measured).map(([name, forms]) => [
      name,
      {
        ...(budget.pages[name]?.['//'] ? { '//': budget.pages[name]['//'] } : {}),
        ...forms,
      },
    ]),
  );
  writeFileSync(BUDGET_PATH, `${JSON.stringify(budget, null, 2)}\n`);
  console.log('\nlighthouse-budget.json rewritten. Commit it with the change that earned it.');
  process.exit(0);
}

if (!ci) process.exit(0);

const budget = JSON.parse(readFileSync(BUDGET_PATH, 'utf8'));
const shortfalls = [];
const gains = [];

for (const [name, forms] of Object.entries(measured)) {
  for (const [preset, scores] of Object.entries(forms)) {
    const expected = budget.pages[name]?.[preset];
    if (!expected) {
      shortfalls.push(`${name}/${preset} has no entry in lighthouse-budget.json`);
      continue;
    }
    for (const category of CATEGORIES) {
      const floor = expected[category] - budget.tolerance;
      if (scores[category] < floor) {
        shortfalls.push(
          `${name}/${preset} ${category}: ${String(scores[category])} against a committed ` +
            `${String(expected[category])} (floor ${String(floor)})`,
        );
      } else if (scores[category] > expected[category] + budget.tolerance) {
        gains.push(
          `${name}/${preset} ${category}: ${String(scores[category])}, up from ` +
            `${String(expected[category])}`,
        );
      }
    }
  }
}

// The distance still to go, printed every run so it cannot quietly stop being a goal.
const behind = Object.entries(measured)
  .flatMap(([name, forms]) =>
    Object.entries(forms).map(([preset, scores]) => ({ name, preset, value: scores.performance })),
  )
  .filter((row) => row.value < budget.aspiration.performance);

console.log('');
if (behind.length > 0) {
  console.log(
    `Below PLAN.md's Performance >= ${String(budget.aspiration.performance)}: ` +
      behind.map((r) => `${r.name}/${r.preset} ${String(r.value)}`).join(', '),
  );
  console.log(
    'Tracked as Q-46. The gate holds the line; it does not pretend the line is the goal.',
  );
}

if (gains.length > 0) {
  console.log(`\n${String(gains.length)} score(s) improved beyond the budget:`);
  for (const gain of gains) console.log(`  ${gain}`);
  console.log('Run `pnpm lighthouse:ci --update` to bank them, so the ratchet cannot slip back.');
}

if (shortfalls.length > 0) {
  console.error(`\n${String(shortfalls.length)} shortfall(s):`);
  for (const shortfall of shortfalls) console.error(`  ${shortfall}`);
  process.exit(1);
}

console.log('\nlighthouse: every gated score is at or above its committed budget.');
