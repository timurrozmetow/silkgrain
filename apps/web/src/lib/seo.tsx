import { useEffect } from 'react';

/**
 * Document head, managed from inside the page that knows what belongs in it.
 *
 * Not the router's `head` option and not `react-helmet-async`. The router's runs with route
 * context, and every title worth setting here depends on data React Query fetches inside the
 * component - a product name, a search term, a category. Helmet would work and is a dependency
 * for something the platform can do in sixty lines.
 *
 * Every tag this writes carries `data-seo`, and each render clears the previous set before
 * writing the new one. So navigating from a product to the shop cannot leave the product's
 * description behind, which is the failure mode of every hand-rolled head manager that only
 * ever adds.
 */

const MANAGED = 'data-seo';

export interface SeoProps {
  title: string;
  description: string;
  /**
   * The address search engines should treat as this page's own.
   *
   * Passed explicitly rather than taken from `location`, because a filtered, sorted, paginated
   * shop URL is not a page in its own right - it is one view of `/shop`, and pointing every
   * combination at itself is how a catalogue of thirty products becomes ten thousand
   * near-identical indexed pages.
   */
  canonicalPath: string;
  /** `product` for a product page, `website` elsewhere. */
  type?: 'website' | 'product' | 'article';
  imageUrl?: string | null;
  /** Structured data, already shaped. Serialised into one `application/ld+json` block. */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
  /** Keeps a page out of the index without keeping it out of the crawl. */
  noIndex?: boolean;
}

function upsertMeta(attribute: 'name' | 'property', key: string, content: string): void {
  const element = document.createElement('meta');
  element.setAttribute(attribute, key);
  element.setAttribute('content', content);
  element.setAttribute(MANAGED, '');
  document.head.append(element);
}

export function Seo({
  title,
  description,
  canonicalPath,
  type = 'website',
  imageUrl,
  jsonLd,
  noIndex = false,
}: SeoProps) {
  const serialisedJsonLd = jsonLd === undefined ? null : JSON.stringify(jsonLd);

  useEffect(() => {
    const canonical = new URL(canonicalPath, window.location.origin).toString();

    document.title = title;

    for (const stale of document.head.querySelectorAll(`[${MANAGED}]`)) stale.remove();

    upsertMeta('name', 'description', description);
    if (noIndex) upsertMeta('name', 'robots', 'noindex,follow');

    const link = document.createElement('link');
    link.rel = 'canonical';
    link.href = canonical;
    link.setAttribute(MANAGED, '');
    document.head.append(link);

    upsertMeta('property', 'og:title', title);
    upsertMeta('property', 'og:description', description);
    upsertMeta('property', 'og:type', type);
    upsertMeta('property', 'og:url', canonical);
    upsertMeta('property', 'og:site_name', 'SilkGrain');
    // No default image: decision D-9 says there is no logo asset yet, and an OG card pointing
    // at a placeholder is worse than one the platform renders from the title alone.
    if (imageUrl != null && imageUrl.length > 0) upsertMeta('property', 'og:image', imageUrl);
    upsertMeta('name', 'twitter:card', imageUrl == null ? 'summary' : 'summary_large_image');

    if (serialisedJsonLd !== null) {
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.textContent = serialisedJsonLd;
      script.setAttribute(MANAGED, '');
      document.head.append(script);
    }
    // `jsonLd` is an object literal at every call site, so a new identity each render. The
    // serialised form is what actually changes, and depending on it keeps this effect from
    // rewriting the whole head on every keystroke in a search field.
  }, [title, description, canonicalPath, type, imageUrl, serialisedJsonLd, noIndex]);

  return null;
}

/** `https://silkgrain.com/product/devzira` from `/product/devzira`. */
export function absoluteUrl(path: string): string {
  return new URL(path, window.location.origin).toString();
}

/**
 * The organisation block, sent once from the home page.
 *
 * Repeating it on every page is legal and pointless; search engines take it from the site's
 * front door.
 *
 * It is also the one place a contact detail is still written down, and deliberately so.
 *
 * The footer and `/help` read the address and the email from `GET /api/settings`, because those
 * are rows the owner edits and a hard-coded copy goes stale silently. This constant does not,
 * for a reason that is a modelling gap rather than an oversight: `schema.org/PostalAddress` wants
 * `streetAddress`, `addressLocality`, `addressRegion` and `postalCode` as separate fields, and
 * `store.address` is one free-text line. Splitting a line of text into four is a guess that gets
 * a shop's address wrong in a machine-readable way, which is worse than a stale one a person can
 * see. It is in `BACKLOG.md` as structured address fields.
 *
 * So: if the shop moves, this is the second place to change, and the only one.
 */
export const ORGANIZATION_JSON_LD: Record<string, unknown> = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'SilkGrain',
  description:
    'Central Asian rice, lentils, dried fruit and spices, imported direct from the growers.',
  address: {
    '@type': 'PostalAddress',
    streetAddress: '5850 San Felipe St',
    addressLocality: 'Houston',
    addressRegion: 'TX',
    postalCode: '77057',
    addressCountry: 'US',
  },
  email: 'hello@silkgrain.com',
};

export function breadcrumbJsonLd(trail: { name: string; path: string }[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}
