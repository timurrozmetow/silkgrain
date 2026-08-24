import { describe, expect, it } from 'vitest';

import { resetDatabase } from './reset';
import { seed } from './seed/index';

/**
 * The two scripts that can destroy or compromise a database, and the refusals that stop them.
 *
 * Both were found by `scripts/secret-scan.mjs` during task 8.7, and both had the same shape: a
 * guard that was real but aimed at the wrong mistake. `resetDatabase` refused a *mistyped* name
 * while waving through the correct one in the wrong environment, and `seed` refused a database
 * with products in it - which a fresh production database, by definition, does not have.
 *
 * These tests need no database. They assert that the refusal happens before a connection is ever
 * opened, which is the only order that is any use: a guard that runs after `DROP TABLE` is a log
 * line, not a guard.
 */

const PRODUCTION_URL = 'mysql://silkgrain:hunter2@10.0.0.4:3306/silkgrain';

describe('resetDatabase', () => {
  it('refuses production even though the database is called silkgrain', () => {
    // The whole point. The name check passes here - the production database has the project's
    // name - so `NODE_ENV` is the only thing between this call and every table the shop owns.
    return expect(resetDatabase(PRODUCTION_URL, 'production')).rejects.toThrow(
      /Refusing to reset a production database/,
    );
  });

  it('still refuses a database that is not this project, in any environment', () => {
    return expect(
      resetDatabase('mysql://root:x@127.0.0.1:3307/wordpress', 'development'),
    ).rejects.toThrow(/only silkgrain and silkgrain_test/);
  });

  it('names the recovery that does exist, rather than only saying no', () => {
    // D-17: migrations are forward-only, so the answer in production is the pre-deploy dump. An
    // error that does not say that invites the next person to reach for `--force`.
    return expect(resetDatabase(PRODUCTION_URL, 'production')).rejects.toThrow(/backup-db\.sh/);
  });
});

describe('seed', () => {
  it('refuses production before it touches the database', async () => {
    // `null` as the handle is the assertion: if the guard did not come first, this would throw a
    // TypeError from `db.select` instead of the refusal, and the test would fail on the message.
    await expect(seed(null as never, 'production')).rejects.toThrow(
      /Refusing to seed a production database/,
    );
  });

  it('says why, because the reason is not obvious from the word "seed"', async () => {
    // A reader who thinks this is only demo catalogue data would work around the guard. It is
    // also three admin accounts sharing a password that is committed to this repository.
    await expect(seed(null as never, 'production')).rejects.toThrow(/admin accounts/);
  });
});
