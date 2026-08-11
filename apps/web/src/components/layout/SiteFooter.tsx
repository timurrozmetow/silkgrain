import { Icon, type IconName } from '@silkgrain/ui';
import { Link } from '@tanstack/react-router';

import { Wordmark } from './Wordmark';

/**
 * Four columns and a bottom bar.
 *
 * The payment badges are bordered mono text rather than brand logos, exactly as the mockup
 * draws them. That is not a placeholder: card-scheme marks come with trademark rules about
 * size, clear space and colour, and a row of misused logos is worse than none. Real marks go
 * in when someone has read Visa's and Mastercard's guidelines.
 */

/**
 * Only routes that exist. The design's Shop and Company columns fill out as the phase builds
 * their destinations; see the note in `SiteHeader`.
 */
const COLUMNS: { heading: string; links: { to: string; label: string }[] }[] = [
  {
    heading: 'Shop',
    links: [
      { to: '/shop', label: 'All Products' },
      { to: '/shop/c/rice', label: 'Rice & Grains' },
      { to: '/shop/c/lentils', label: 'Lentils & Legumes' },
      { to: '/shop/c/fruits', label: 'Dried Fruits' },
      { to: '/shop/c/spices', label: 'Spices & Herbs' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { to: '/about', label: 'Our Story' },
      { to: '/wholesale', label: 'Wholesale' },
      { to: '/recipes', label: 'Recipes' },
      { to: '/help', label: 'Help & FAQ' },
      { to: '/track', label: 'Track Order' },
    ],
  },
];

const SOCIALS: { href: string; icon: IconName; label: string }[] = [
  { href: 'https://instagram.com', icon: 'instagram-logo', label: 'Instagram' },
  { href: 'https://facebook.com', icon: 'facebook-logo', label: 'Facebook' },
  { href: 'https://linkedin.com', icon: 'linkedin-logo', label: 'LinkedIn' },
];

const PAYMENTS = ['Visa', 'Mastercard', 'Amex', 'PayPal', 'Apple Pay'];

export function SiteFooter() {
  return (
    <footer className="mt-24 bg-green-footer text-onfooter mobile:mt-16">
      <div className="mx-auto max-w-container px-gutter py-16 tablet:px-gutter-tablet mobile:px-gutter-mobile mobile:py-12">
        <div className="grid grid-cols-[1.4fr_1fr_1fr_1.2fr] gap-12 tablet:grid-cols-2 tablet:gap-10 mobile:grid-cols-1 mobile:gap-8">
          <div>
            <Wordmark onDark />
            <p className="mt-5 max-w-[34ch] text-[14px] leading-relaxed text-onfooter-muted">
              Ancient grains, dried fruit and spices, bought direct from the families who grow them
              and shipped fresh from Houston.
            </p>
            <div className="mt-6 flex gap-2">
              {SOCIALS.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={social.label}
                  className="flex h-11 w-11 items-center justify-center rounded-sm border border-white/15 text-onfooter-muted transition-colors hover:border-gold hover:text-gold"
                >
                  <Icon name={social.icon} size={18} />
                </a>
              ))}
            </div>
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-gold">
                {column.heading}
              </h2>
              <ul className="mt-5 space-y-3">
                {column.links.map((link) => (
                  <li key={link.to}>
                    <Link
                      to={link.to}
                      className="text-[14px] text-onfooter-muted transition-colors hover:text-gold"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}

          <div>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-gold">
              Get in touch
            </h2>
            <ul className="mt-5 space-y-3 text-[14px] text-onfooter-muted">
              <li className="flex gap-3">
                <Icon name="map-pin" size={16} className="mt-0.5 shrink-0 text-gold" />
                <span>5850 San Felipe St, Houston, TX 77057</span>
              </li>
              <li className="flex gap-3">
                <Icon name="envelope-simple" size={16} className="mt-0.5 shrink-0 text-gold" />
                <a href="mailto:hello@silkgrain.example" className="hover:text-gold">
                  hello@silkgrain.example
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-container items-center justify-between gap-6 px-gutter py-6 tablet:px-gutter-tablet mobile:flex-col mobile:px-gutter-mobile">
          <p className="font-mono text-[11px] text-onfooter-muted">
            &copy; {new Date().getFullYear()} SilkGrain LLC &middot; Houston, Texas
          </p>
          <ul className="flex flex-wrap gap-2">
            {PAYMENTS.map((method) => (
              <li
                key={method}
                className="rounded-sm border border-white/15 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-onfooter-muted"
              >
                {method}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
