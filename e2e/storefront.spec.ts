import { expect, test } from '@playwright/test';

/**
 * The paths a customer actually walks, against the built storefront.
 *
 * These are deliberately few. An end-to-end test is the slowest and most brittle kind there is, so
 * it earns its place only where the value is a *seam* between systems that the 435 integration
 * tests cannot see: the browser rendering what the API sent, the cart store surviving a page load,
 * a signed-in session outliving a reload.
 *
 * What is not here, and why: there is no checkout. `POST /api/checkout/intent` needs a Stripe key
 * nobody has (D-27), and PayPal is in `BACKLOG.md` (D-26). Task 8.2 asks for "both payment
 * providers and a payment failure"; none of the three can be driven, and a test that mocked the
 * provider would assert that the mock works. That gap is recorded rather than papered over.
 */

test.describe('a guest browsing the shop', () => {
  test('reaches a product from the home page and can read its price', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SilkGrain/);

    // The rails are populated from the API, so a heading alone would pass against an empty shop.
    const firstCard = page.locator('a[href^="/product/"]').first();
    await expect(firstCard).toBeVisible();

    const name = (await firstCard.innerText()).split('\n')[0]?.trim() ?? '';
    expect(name.length).toBeGreaterThan(0);

    await firstCard.click();
    await expect(page).toHaveURL(/\/product\//);
    // The button carries the price, so its presence proves the variant loaded and priced.
    await expect(page.getByRole('button', { name: /Add to Cart · \$/ })).toBeVisible();
  });

  test('carries a cart across a full page load', async ({ page }) => {
    await page.goto('/shop');
    await page.locator('a[href^="/product/"]').first().click();
    await expect(page).toHaveURL(/\/product\//);

    const addToCart = page.getByRole('button', { name: /Add to Cart · \$/ });
    const priced = await addToCart.innerText();
    const price = /\$[\d,]+\.\d{2}/.exec(priced)?.[0] ?? '';
    expect(price).not.toBe('');

    await addToCart.click();

    // A hard navigation, not a client-side one: the cart lives in a store that has to survive the
    // page being thrown away and rebuilt, and only a real load proves it does.
    await page.goto('/cart');
    await expect(page.getByRole('heading', { name: 'Shopping Cart' })).toBeVisible();

    // The figure the product page quoted is the figure the cart charges. The cart holds variant
    // ids and quantities only and reprices against the API, so this is the seam worth checking.
    await expect(page.getByText('Order Summary')).toBeVisible();
    await expect(page.locator('body')).toContainText(price);
  });

  test('finds a product by searching for it', async ({ page }) => {
    await page.goto('/shop?q=rice');
    // The list is server-filtered; an empty result would still render the page, so the assertion
    // is on a card rather than on the heading.
    await expect(page.locator('a[href^="/product/"]').first()).toBeVisible();
    await expect(page.locator('body')).toContainText(/rice/i);
  });

  test('says so plainly when a filter matches nothing', async ({ page }) => {
    await page.goto('/shop?q=zzzznotathing');
    await expect(page.locator('a[href^="/product/"]')).toHaveCount(0);
    // An empty state rather than a blank page: the difference between "nothing matched" and
    // "something broke" has to be visible to the person looking at it.
    await expect(page.locator('main')).toContainText(/no|nothing|match/i);
  });

  test('serves a real 404 for a product that does not exist', async ({ page }) => {
    await page.goto('/product/not-a-real-product');
    // The shop's own words, not a framework's. Asserting on the copy is the point: a blank page
    // and a "we do not stock that" both render without error, and only one of them is the page.
    await expect(page.locator('main')).toContainText('We do not stock that');
    await expect(page.getByRole('link', { name: /Browse the pantry/i })).toBeVisible();
  });
});

test.describe('the storefront reads its settings from the API', () => {
  test('quotes the free-shipping figure the checkout charges from', async ({ page }) => {
    // D-22: the number comes from `shipping_rates.free_above_cents` through `GET /api/settings`,
    // not from a string in the bundle. Three components used to hard-code "$75"; this asserts the
    // rendered page agrees with what the API computes.
    const settings = await page.request.get('http://localhost:3001/api/settings');
    expect(settings.ok()).toBe(true);
    const { freeShippingFromCents } = (await settings.json()) as {
      freeShippingFromCents: number | null;
    };

    await page.goto('/');
    if (freeShippingFromCents === null) {
      // No active rate offers free shipping, so the bar must promise none.
      await expect(page.locator('body')).not.toContainText(/Complimentary shipping over/);
      return;
    }

    const dollars = `$${String(Math.round(freeShippingFromCents / 100))}`;
    await expect(page.locator('body')).toContainText(dollars);
  });
});
