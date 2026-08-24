import { hash, verify } from '@node-rs/argon2';

/**
 * `@node-rs/argon2` exports `Algorithm` and `Version` as ambient `const enum`s, which
 * TypeScript refuses to inline under `verbatimModuleSyntax` - the values would have to be
 * erased at compile time and there is no runtime object to fall back to. The two numbers are
 * part of the Argon2 specification and are stamped into every hash string this produces
 * (`$argon2id$v=19$`), so a drift would be visible in the database immediately.
 */
const ARGON2ID = 2;
const ARGON2_V13 = 1;

/**
 * Argon2id, never bcrypt.
 *
 * The parameters are OWASP's current recommendation for Argon2id: 19 MiB of memory, two
 * passes, one lane. Memory is what actually costs an attacker with a GPU farm - raising
 * `timeCost` alone buys much less - and 19 MiB per hash is affordable for a login endpoint
 * that is itself rate limited.
 *
 * `@node-rs/argon2` rather than the `argon2` package: it ships prebuilt NAPI binaries, so the
 * repository installs on a Windows machine with no build tools, which is the machine this is
 * developed on.
 */
const OPTIONS = {
  algorithm: ARGON2ID,
  version: ARGON2_V13,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed hash: a corrupt row must read as "wrong
 * password" to the caller, not as a 500 that tells an attacker the account exists.
 */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
}

/**
 * Burns the same time a real verification would.
 *
 * Called when the email does not exist. Without it a missing account answers in under a
 * millisecond and a real one in fifty, and that difference alone enumerates the customer
 * list. The hash is produced once, lazily, from a fixed string that is never a credential;
 * every later call is exactly one verification, the same work the real path does.
 */
let decoyHash: Promise<string> | undefined;

export async function equaliseTiming(): Promise<void> {
  decoyHash ??= hashPassword('silkgrain-timing-decoy');
  await verifyPassword(await decoyHash, 'deliberately-not-the-decoy');
}
