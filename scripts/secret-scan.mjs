#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * Secret scanning, without gitleaks.
 *
 * `PLAN.md` task 8.7 names gitleaks. It is a Go binary, this machine has no admin rights and no
 * package manager that could place one, and downloading a release archive to satisfy a checklist
 * would be worse than the checklist: a scanner nobody can run in the one place it matters is not a
 * control. So the scan is here, in the repository, in the language the repository already builds
 * with, and it runs inside `pnpm verify` like everything else that is allowed to fail the build.
 *
 * Two modes:
 *
 *   node scripts/secret-scan.mjs             the tracked working tree - fast, runs in `verify`
 *   node scripts/secret-scan.mjs --history   every blob that ever existed - slow, run by hand
 *
 * The second one is the one that matters after a mistake. A key committed and deleted in the next
 * commit is still in the pack file and still on every clone, and the working tree looks clean.
 *
 * ## Why the rules are shaped the way they are
 *
 * The naive rule - "flag anything called SECRET" - flags `.env.example`, the seed, the compose
 * file and the test fixtures on the first run, and the honest response to a scanner that cries
 * wolf is to stop running it. So the provider rules are written against the *format of a real
 * credential* rather than the name next to it: a live Stripe key is `sk_live_` followed by a long
 * run of unbroken alphanumerics, and `sk_test_replace_me` cannot match that pattern because of the
 * underscore. The placeholders in this repository are excluded by their own shape, not by a list.
 *
 * Where format is not enough - a password is just a string - the rule is entropy over an
 * assignment to a secret-shaped name, and each accepted value is pinned by fingerprint in
 * `ALLOWED` with a reason. A fingerprint rather than a path, deliberately: allow-listing
 * `docker-compose.dev.yml` would let the next secret added to that file through silently, whereas
 * allow-listing one value means a second value in the same file still fails.
 */

const HISTORY = process.argv.includes('--history');

/** Never worth reading: not ours, or machine-generated, or binary. */
const SKIP = [
  /^silkgrain-design-prompt\//, // the read-only handoff bundle
  /^pnpm-lock\.yaml$/,
  /^\.services\//,
  /\.(png|jpe?g|webp|gif|ico|woff2?|ttf|pdf|zip|exe)$/i,
];

/**
 * A real credential's shape.
 *
 * Each `pattern` describes the issued format, not the variable name. The trailing length bounds are
 * what separate an issued key from a placeholder, and they are deliberately at the low end of what
 * each provider actually issues.
 */
const RULES = [
  { id: 'stripe-secret-key', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/g },
  { id: 'stripe-publishable-key', pattern: /\bpk_live_[A-Za-z0-9]{20,}/g },
  { id: 'stripe-webhook-secret', pattern: /\bwhsec_[A-Za-z0-9]{24,}/g },
  { id: 'aws-access-key-id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'github-token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/g },
  { id: 'github-fine-grained-pat', pattern: /\bgithub_pat_[A-Za-z0-9_]{60,}/g },
  { id: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { id: 'sendgrid-key', pattern: /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g },
  { id: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  {
    id: 'private-key-block',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  // A signed token is a credential even when nobody remembers issuing it. Requires real base64
  // after the header, so the regex *literals* in the e2e specs do not match themselves.
  { id: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
];

/**
 * A password has no format, so it is caught by what surrounds it and how random it looks.
 *
 * The name must read like a secret and the value must be long and disordered. `password: ''` and
 * `secret: 'changeme'` are neither, which is the point - a rule that flagged them would be
 * flagging every test in the repository.
 */
const ASSIGNMENT =
  /\b([A-Za-z_][A-Za-z0-9_]{0,40}(?:SECRET|PASSWORD|PASSWD|TOKEN|APIKEY|API_KEY|PRIVATE_KEY|CREDENTIAL)[A-Za-z0-9_]{0,20})\b\s*[:=]\s*["'`]([^"'`\n]{16,})["'`]/gi;

/** Shannon entropy in bits per character. English prose sits near 3, random base64 above 4.5. */
function entropy(value) {
  const counts = new Map();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** Words that say "this is not the real one" louder than any entropy calculation. */
const PLACEHOLDER = /replace|example|changeme|placeholder|your[-_]|xxx|todo|dummy|sample|<.+>/i;

const fingerprint = (value) => createHash('sha256').update(value).digest('hex').slice(0, 16);

/**
 * Values that are meant to be readable, pinned one at a time.
 *
 * Every entry is a development credential, and every one of them has a stated reason why it cannot
 * become a production credential. Most exist identically in `docker-compose.dev.yml`, in
 * `dev-setup.ps1` and in `.env.example` on purpose - CLAUDE.md requires those three to agree, and
 * they describe a MySQL bound to 127.0.0.1 with no data in it that anybody would want.
 *
 * Pinned by fingerprint rather than by path, deliberately: allow-listing a file would let the next
 * secret added to that file through silently, whereas allow-listing one value means a second value
 * in the same file still fails.
 */
const ALLOWED = new Map([
  [
    fingerprint('silkgrain_dev_only'),
    'local MySQL root password, 127.0.0.1 only, matches the compose file',
  ],
  [fingerprint('silkgrain-dev-secret'), 'local MinIO secret key, matches the compose file'],
  [
    fingerprint('dev_access_secret_change_me_in_production_0123456789'),
    '.env.example JWT placeholder; loadEnv refuses it when NODE_ENV=production (env.test.ts)',
  ],
  [
    fingerprint('dev_refresh_secret_change_me_in_production_0123456789'),
    '.env.example JWT placeholder; loadEnv refuses it when NODE_ENV=production (env.test.ts)',
  ],
  [
    fingerprint('SilkGrainDev!2026'),
    'password on every seeded demo account. Allowed only because `seed()` now refuses to run ' +
      'when NODE_ENV=production - before that guard existed this was a real finding, since a ' +
      'fresh production database is empty and the seed would have created an owner account ' +
      'holding it. Both facts are pinned by apps/api/src/db/guard.test.ts.',
  ],
]);

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });

/** Every path/content pair to look at: the tracked tree, or every blob that ever existed. */
function* sources() {
  if (!HISTORY) {
    for (const path of git(['ls-files']).split('\n').filter(Boolean)) {
      if (SKIP.some((skip) => skip.test(path))) continue;
      let content;
      try {
        content = readFileSync(path, 'utf8');
      } catch {
        continue; // unreadable or binary - nothing a regex would find anyway
      }
      yield { where: path, content };
    }
    return;
  }

  // `--objects` pairs every blob with a path it was once stored under, which is what makes a
  // finding in history actionable rather than a bare hash.
  const listed = git(['rev-list', '--all', '--objects']).split('\n');
  const seen = new Set();
  for (const line of listed) {
    const space = line.indexOf(' ');
    if (space === -1) continue;
    const hash = line.slice(0, space);
    const path = line.slice(space + 1);
    if (!path || seen.has(hash)) continue;
    if (SKIP.some((skip) => skip.test(path))) continue;
    seen.add(hash);
    let content;
    try {
      content = git(['cat-file', '-p', hash]);
    } catch {
      continue;
    }
    yield { where: `${path} @ ${hash.slice(0, 8)}`, content };
  }
}

function scan(where, content) {
  const found = [];
  const lineOf = (index) => content.slice(0, index).split('\n').length;

  for (const rule of RULES) {
    for (const match of content.matchAll(rule.pattern)) {
      const value = match[0];
      if (ALLOWED.has(fingerprint(value))) continue;
      found.push({ where, line: lineOf(match.index), rule: rule.id, value });
    }
  }

  for (const match of content.matchAll(ASSIGNMENT)) {
    const [, name, value] = match;
    if (value === undefined || name === undefined) continue;
    if (ALLOWED.has(fingerprint(value))) continue;
    if (PLACEHOLDER.test(value)) continue;
    // A template literal is a value being *built*, and what the regex captured is source text
    // rather than a credential - `seed-unsubscribe-${i}` scores as 49 disordered characters while
    // the thing it produces is a predictable twenty. Score only the literal part: if what is
    // hard-coded around the holes is not itself long and random, there is no secret here.
    // The closing brace is optional because the capture often does not reach it: the value stops
    // at the first quote, and an interpolation like `${x.padStart(4, '0')}` contains one.
    const literal = value.replace(/\$\{[^}]*\}?/g, '');
    if (literal.length < 16) continue;
    if (entropy(literal) < 3.5) continue;
    found.push({ where, line: lineOf(match.index), rule: `high-entropy:${name}`, value: literal });
  }

  return found;
}

/**
 * Proof that the scanner can fail.
 *
 * A check that runs in `pnpm verify` and has been green since the day it was written is
 * indistinguishable from a check that cannot go red, and this repository's rule is that nothing
 * ships on "probably fine". These are synthetic credentials in the issued format, and each one
 * must be caught; the last two are the false positives that made earlier drafts of this file
 * unusable, and each must NOT be.
 *
 * Every sample is assembled from pieces rather than written out, and that is not stylistic. The
 * first version of this function spelled them in full, and the scanner promptly failed the build
 * by finding all five of them in this file - which is the strongest evidence available that the
 * rules work, and also unrunnable. Splitting each one across a `+` breaks the pattern in the
 * source text while leaving the string the rules see at runtime byte-for-byte identical.
 *
 * The alternative was to skip this file, and skipping it would mean a real key pasted here is the
 * one key in the repository nobody looks for.
 */
function selfTest() {
  const cases = [
    ['sk_live_' + '51Hx9QpKZvREDACTEDabcdefghijklmn', true, 'a live Stripe key'],
    ['whsec_' + '9fK2mQx7ZpLr4TvNb8YcWd3EhJs6Gu1A', true, 'a webhook signing secret'],
    ['AKIA' + 'IOSFODNN7EXAMPLE', true, 'an AWS access key id'],
    ['-----BEGIN RSA ' + 'PRIVATE KEY-----', true, 'a private key block'],
    ['const DB_PASSWORD = "' + 'xQ7#mK9$pL2@vN4wZ8rT' + '"', true, 'a high-entropy password'],
    ['STRIPE_SECRET_KEY=sk_test_replace_me', false, 'the placeholder in .env.example'],
    ['const token = `seed-unsubscribe-${String(i).padStart(4, "0")}`', false, 'a built template'],
  ];

  let broken = 0;
  for (const [sample, shouldCatch, description] of cases) {
    const caught = scan('self-test', sample).length > 0;
    if (caught !== shouldCatch) {
      console.error(
        `  self-test FAILED: ${shouldCatch ? 'missed' : 'falsely flagged'} ${description}`,
      );
      broken += 1;
    }
  }

  if (broken > 0) {
    console.error(`\nsecret-scan: ${String(broken)} of its own rules are broken. Fix them first.`);
    process.exit(1);
  }
  console.log(`secret-scan: self-test passed (${String(cases.length)} cases).`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

// Always, not behind a flag: the rules cost microseconds to verify and the alternative is a green
// run that means nothing.
selfTest();

const findings = [];
for (const { where, content } of sources()) findings.push(...scan(where, content));

const scope = HISTORY ? 'every blob in history' : 'the tracked working tree';

if (findings.length === 0) {
  console.log(`secret-scan: clean across ${scope}.`);
  process.exit(0);
}

console.error(`secret-scan: ${String(findings.length)} finding(s) across ${scope}.\n`);
for (const finding of findings) {
  // Enough of the value to recognise it, never enough to use it - the scanner's own output ends up
  // in CI logs, which is exactly the sort of place a secret should not be copied to.
  const masked = `${finding.value.slice(0, 8)}...(${String(finding.value.length)} chars)`;
  console.error(`  ${finding.where}:${String(finding.line)}`);
  console.error(`    ${finding.rule}  ${masked}`);
}
console.error(
  `\nIf one of these is deliberately public, add its fingerprint to ALLOWED in this file with the\n` +
    `reason. If it is not, rotate it first - it is already on every clone - and only then remove it.`,
);
process.exit(1);
