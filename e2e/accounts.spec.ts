import { expect, test } from '@playwright/test';

/**
 * The two authentication contours, in a browser.
 *
 * The integration tests already prove the tokens: rotation, revocation, the `typ` claim keeping a
 * customer token off an admin route. What they cannot prove is the part that only exists in a
 * browser - that the access token really does live in memory and nowhere a script can read it, and
 * that a reload therefore rebuilds the session from the httpOnly refresh cookie rather than from
 * storage. That is decision D-15, and this is the only place it can be checked.
 */

/** A fresh address per run: the suite drives a shared database and registration is unique on it. */
function newEmail(): string {
  return `e2e-${String(Date.now())}-${String(Math.floor(Math.random() * 10_000))}@example.com`;
}

test.describe('a customer', () => {
  test('registers, and the session survives a reload', async ({ page }) => {
    const email = newEmail();

    await page.goto('/account');
    // Two tabs, one form at a time - so the fields are unambiguous once the right tab is chosen.
    await page.getByRole('tab', { name: 'Create account' }).click();

    await page.getByLabel('First name').fill('Nodira');
    await page.getByLabel('Last name').fill('Yusupova');
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByLabel('Password', { exact: false }).fill('Silk-Grain-2026');
    await page.getByRole('button', { name: 'Create account' }).click();

    // Signed in: the account page stops offering the forms and starts naming the person.
    await expect(page.locator('main')).toContainText(/Nodira/i, { timeout: 15_000 });

    // The token is in a module variable, so a reload starts with nothing and has to mint a new
    // one from the refresh cookie. If it were in localStorage this would pass for the wrong
    // reason - so the storage check below is what makes the assertion mean anything.
    await page.reload();
    await expect(page.locator('main')).toContainText(/Nodira/i, { timeout: 15_000 });
  });

  test('keeps the access token out of anywhere a script can read it', async ({ page }) => {
    const email = newEmail();

    await page.goto('/account');
    await page.getByRole('tab', { name: 'Create account' }).click();
    await page.getByLabel('First name').fill('Rustam');
    await page.getByLabel('Last name').fill('Aliyev');
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByLabel('Password', { exact: false }).fill('Silk-Grain-2026');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.locator('main')).toContainText(/Rustam/i, { timeout: 15_000 });

    const stored = await page.evaluate(() => ({
      local: JSON.stringify(window.localStorage),
      session: JSON.stringify(window.sessionStorage),
      // The refresh cookie is httpOnly, so `document.cookie` must not show it either.
      cookie: document.cookie,
    }));

    // A JWT is three base64 segments separated by dots; nothing shaped like one may be readable.
    const jwt = /eyJ[\w-]+\.[\w-]+\.[\w-]+/;
    expect(stored.local).not.toMatch(jwt);
    expect(stored.session).not.toMatch(jwt);
    expect(stored.cookie).not.toMatch(jwt);
    expect(stored.cookie).not.toMatch(/refresh/i);
  });

  test('is told what is wrong when the password is', async ({ page }) => {
    await page.goto('/account');
    // Sign in is the default tab.
    await page.getByRole('textbox', { name: 'Email' }).fill('nobody@example.com');
    await page.getByLabel('Password', { exact: false }).fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    // The shop's own words. A message, not a blank form or a spinner that never resolves - and
    // deliberately one message for both causes, so the form cannot be used to learn which
    // addresses are registered.
    await expect(page.getByRole('alert')).toContainText('That email and password do not match.', {
      timeout: 15_000,
    });
  });
});

test.describe('the back office', () => {
  test('refuses to render behind a sign-in until there is one', async ({ page }) => {
    // The admin is a separate build under /admin with its own contour and its own cookie; the
    // storefront's session grants nothing here.
    await page.goto('http://localhost:4174/admin/');
    await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 15_000 });
  });
});
