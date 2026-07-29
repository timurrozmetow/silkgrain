# Handoff: SilkGrain Storefront — Responsive / Adaptive Implementation

## Overview
SilkGrain is a premium e-commerce storefront for Central Asian pantry goods (aged rice, lentils,
dried fruit, spices) sold both retail (B2C) and wholesale (B2B), shipping from Houston, TX.

This package documents the **full storefront design and — as the primary focus — its responsive
behaviour across desktop, tablet and phone.** Sixteen screens plus an admin panel are covered.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes that show intended
look, layout and behaviour. **They are not production code to copy directly.**

The task is to **recreate these designs in the target codebase's existing environment** (React,
Vue, SwiftUI, native, etc.) using its established component patterns, styling solution and
libraries. If no environment exists yet, choose the most appropriate framework for the project
and implement the designs there.

### ⚠️ Important: do NOT port the responsive CSS literally
The prototype runs in a constrained environment that only allows **inline styles**, so its
responsive layer is implemented as a hack: a `<style>` block full of attribute-substring selectors
with `!important`, e.g.

```css
@media (max-width:760px){
  [style*="display: grid"],[style*="display:grid"]{grid-template-columns:1fr!important;}
}
```

This is a **prototype workaround only**. In production, express the same behaviour idiomatically —
Tailwind responsive variants (`grid-cols-1 md:grid-cols-3 lg:grid-cols-4`), CSS modules with real
media queries, container queries, or the platform's native layout system. Use the
**Responsive Behaviour** section below as the specification; treat the prototype CSS only as
evidence of intent.

## Fidelity
**High-fidelity (hifi).** Final colours, typography, spacing, radii, shadows, motion and copy are
all decided. Recreate the UI pixel-accurately using the codebase's existing libraries and patterns.

---

## Responsive Behaviour

### Breakpoints
| Name | Range | Grid basis |
|---|---|---|
| Desktop | `> 1024px` | Content max-width **1280px**, gutters **28px** |
| Tablet | `≤ 1024px` | Fluid, gutters **22px** |
| Mobile | `≤ 760px` | Fluid, gutters **16px** |

Only two breakpoints are needed. Design mobile-first if the codebase prefers it; the values below
are the authored desktop values plus their overrides.

### Layout rules per breakpoint

**Tablet (≤1024px)**
- All two-column section grids collapse to a single column. Affected ratios in the prototype:
  `1.02fr 0.98fr` (hero), `1.05fr 0.95fr`, `1.2fr 0.8fr`, `2fr 1fr`, `1fr 1fr`.
- All sidebar layouts collapse to one column, sidebar first, content below:
  `260px 1fr` (shop filters), `1fr 380px` (cart summary), `1fr 400px` (checkout summary),
  `300px 1fr` (nutrition panel), `1fr 320px` (origin media), `240px 1fr` (review summary).
- Product grids: **4 → 3 columns**. Category tiles: **6 → 3 columns**.
- All `position: sticky` columns (`div`, `aside`) become `static` — sticky sidebars must not
  pin once the layout is stacked.
- Display type scales to ~72% of desktop size (only sizes ≥52px are touched).

**Mobile (≤760px)**
- Every grid becomes a single column, **except product grids, which stay 2-up** (gap 14px) so the
  catalogue stays scannable.
- Header: desktop nav and the "Shop Now" button are hidden; a **hamburger** appears and opens a
  left-side slide-in nav panel (330px wide / max 86vw) listing Shop, Recipes, Wholesale, About,
  Help, Wishlist, My Account plus a primary "Shop the pantry" CTA.
- Cart drawer goes **full width** (from 430px). Quick-view modal goes full width (from 840px).
- Section vertical padding halves (92→46, 84→42, 80→40, 78→39, 74→37, 72→36, 64→32, 60→30, 56→28).
- Large gaps (38–70px) clamp to **24px**. Fixed decorative heights shrink
  (600→360, 560→340, 540→330, 480→300, 420→270, 400→260, 380→250, 360→240, 330→230, 320→220).
- Display type scales down hard (84→40, 76→38, 66→34, 56→30, 46→25, 42→24, 36→22, 34→21).
- Large card padding (36/40/64px) reduces to **20px**.
- **Form inputs must render at ≥16px** to prevent iOS auto-zoom on focus.
- **All buttons get `min-height: 44px`** to meet touch-target guidance.
- Admin: sidebar becomes a horizontally scrolling icon strip (logo and user block hidden);
  data tables scroll horizontally inside their card with a **720px min-width** rather than
  collapsing (collapsing table rows destroys the column relationship).

### Responsive gotchas discovered while building
1. **Inline styles serialise with spaces.** React renders `style="display: grid; ..."` — a
   selector written as `[style*="display:grid"]` silently matches nothing. Not relevant if you use
   real classes, but it's why every prototype selector is emitted twice.
2. **Scoped selectors must repeat their prefix.** `[data-atable] X, Y` does *not* scope `Y`.
3. **Never join two rule blocks with a comma** — `a{...},b{...}` makes the parser drop `b`.

---

## Screens / Views

All screens live in one prototype file and are switched by a `screen` state value. In production
these should be **routes**.

| Screen | Route suggestion | Purpose |
|---|---|---|
| Home | `/` | Featured slider, categories, best sellers, bundle, story, wholesale band, new arrivals, testimonials, subscribe |
| Shop / Catalog | `/shop` | Filter sidebar + 3-up product grid + pagination |
| Category landing | `/shop/:category` | Full-bleed photo hero, sub-filter chips, product grid |
| Product detail | `/product/:slug` | Gallery, weight selector, qty, tabs (description / nutrition / origin / reviews), related |
| Cart | `/cart` | Line items, free-shipping progress, promo code, summary |
| Checkout | `/checkout` | Progress stepper, contact, address, shipping method, payment, summary |
| Order confirmation | `/order/:id` | Success state, order summary, track CTA, referral nudge |
| Track order | `/track/:id` | Status timeline, carrier info, map, shipment contents |
| Recipes | `/recipes` | Featured recipe + recipe card grid |
| Wishlist | `/wishlist` | Saved product grid + "discover more" tile |
| Account | `/account` | Profile sidebar, stats, order history with reorder |
| Wholesale | `/wholesale` | Dark hero, benefits, B2B enquiry form |
| About | `/about` | Story hero, narrative, values, stats band, CTA |
| FAQ / Contact | `/help` | Accordion FAQ + contact form + contact methods |
| 404 / Empty states | `*` | 404, empty cart, no-results patterns |
| Admin | `/admin` | Dashboard (KPIs, revenue chart, low stock, recent orders), Products, Orders, Wholesale requests |

### Home page structure (desktop)
1. **Promo bar** — dark `#0B3D2C`, centred 12px text, "Complimentary shipping over $75".
2. **Header** — sticky, translucent `rgba(252,250,244,0.92)` + `backdrop-filter: blur(12px)`,
   74px tall, 1px bottom border `#E4E0D1`. Logo left, nav centre, icon cluster right
   (search, wishlist, account, cart with badge, primary button). Hovering "Shop" opens a
   **mega-menu** panel with a 3-column category list plus a featured product card.
3. **Featured slider** — contained rounded panel (radius 18px), 3 slides at 480px tall,
   auto-advance every 5.5s, thin gold line indicators bottom-left, glass circle arrows
   bottom-right. Slides: Devzira rice / dried fruit / welcome offer.
4. **Hero** — asymmetric two-column, 76px serif headline "Grains of quiet *provenance*",
   gold rule + mono eyebrow, primary CTA + underlined text link, 3 mono stats,
   photo with an offset 1px gold frame and a **parallax translate of `scrollY * 0.12`**.
5. **Category strip**, **Best sellers** (4-up), **The Plov Set bundle** (−12%),
   **Values** (3-up), **Story**, **Wholesale band**, **New arrivals** (4-up),
   **Testimonials** (3-up), **Subscribe & Save**, **Footer**.

---

## Components

### Product card
- Container: `#FCFAF4` background, 1px `#ECE4D3` border, radius 10px, shadow
  `0 2px 12px rgba(14,58,42,0.07)`.
- Hover: `translateY(-6px)`, shadow `0 18px 38px rgba(14,58,42,0.18)`, border `#D9CBA8`,
  transition `.28s cubic-bezier(.22,1,.36,1)`.
- Image: 1:1, on a white→`#F1E9DA` vertical gradient tile; **zooms to `scale(1.07)` over .55s on
  hover**; inset vignette `inset 0 -38px 46px -30px rgba(40,30,10,0.13)`.
- Badges top-left (pill, 10px uppercase): Bestseller `#D3A73B`, New/Organic `#4C7A5A`,
  Sale `#FF5A1E`, Premium `#8F6A14`.
- Wishlist heart top-right: 34px circle, `rgba(252,250,244,0.92)`, hover fill `#B85C38`.
- **Quick view** pill bottom-right of the image, appears over the photo.
- Body: mono uppercase category, 22px Cormorant name, 13px blurb, rating row
  (gold star + mono value + review count + stock dot), weight list, then a divider and a
  price ("from" label + 21px mono) with an "Add to Cart" button.

### Cart drawer
Fixed right, 430px (full width on mobile), `translateX` in over `.5s cubic-bezier(.22,1,.36,1)`,
scrim `rgba(17,23,36,0.44)`. Header with count, free-shipping progress bar, scrollable lines,
sticky footer with subtotal, Checkout and "View full cart".

### Quick view modal
840px, two columns (image / details), centred, shadow `0 40px 90px rgba(11,46,33,0.32)`.
Shows category, name, rating, blurb, weight options, price, "Add to cart" + "Full details".

### Live search
Full-width overlay panel from the top. Large Cormorant input (26px) on a 2px `#0E6B4A` underline,
ESC chip, popular-term chips when empty, and result rows (thumb / name / category / price).

### Mobile nav panel
Left slide-in, 330px, `translateX` over `.45s cubic-bezier(.22,1,.36,1)`. Rows are 16px tall
with an arrow affordance; footer has the primary CTA and the shipping note.

---

## Interactions & Behavior
- **Navigation**: single `screen` state in the prototype → real routes in production. Scroll
  resets to top on change.
- **Slider**: `setInterval` 5500ms, only advances while the home screen is active; arrows and
  indicators jump directly. Transform applied via ref so it survives re-render.
- **Scroll reveal**: elements marked `data-rvl` start at `opacity:0; translateY(26px)` and
  animate to visible via `IntersectionObserver` (threshold 0.12), transition
  `opacity .7s ease, transform .7s cubic-bezier(.22,1,.36,1)`. Elements already above the fold on
  load are exempt so nothing is invisible on first paint.
- **Parallax**: hero image `translateY(scrollY * 0.12)` on a passive scroll listener.
- **Overlays**: cart drawer, search, quick view and mobile nav share one scrim; any of them open
  sets `ovOpen`. Clicking the scrim closes everything.
- **Product page**: weight selection updates unit price and the add-to-cart total; tabs switch
  description / nutrition / origin / reviews. A **sticky add-to-cart bar on scroll is specified
  but not yet built** — implement it.
- **Motion**: entrance `.7s cubic-bezier(.22,1,.36,1)`; hovers `.2s`–`.28s`; respect
  `prefers-reduced-motion` in production (the prototype does not).

## State Management
| State | Type | Purpose |
|---|---|---|
| `screen` | string | Active screen (replace with routing) |
| `activeSlug` | string | Product being viewed |
| `pdWeight` / `pdQty` | string / number | Selected weight and quantity |
| `pdTab` | enum | Product tab |
| `heroSlide` | 0–2 | Slider index |
| `drawerOpen` | bool | Cart drawer |
| `searchOpen` / `q` | bool / string | Search overlay and query |
| `megaOpen` | bool | Header mega-menu |
| `qvSlug` | string\|null | Quick-view target |
| `mnavOpen` | bool | Mobile nav |
| `faqOpen` | number | Open FAQ index |
| `adminTab` | enum | Admin sub-page |

Cart contents, catalogue, pricing, tax (8.25%) and the $75 free-shipping threshold are hardcoded
in the prototype — wire these to real data and server-side calculation.

## Design Tokens

### Colour
| Token | Hex | Use |
|---|---|---|
| Primary | `#0E6B4A` | Buttons, links, emphasis |
| Primary hover | `#10815A` | Button hover |
| Deep band | `#0B3D2C` | Promo bar, wholesale band, dark panels |
| Footer | `#0A2E21` | Footer background |
| Accent gold | `#D3A73B` | Rules, stars, indicators, badges |
| Accent dark | `#8F6A14` | Eyebrow text on light backgrounds |
| Page background | `#F3F0E8` | Default canvas |
| Card / raised | `#FCFAF4` | Cards, header, panels |
| Alt band | `#E9E5D7` | Alternating sections |
| Border | `#E4E0D1` / `#E9E5D8` | Hairlines |
| Ink | `#23231E` | Headings |
| Body | `#6B6456` | Paragraphs |
| Muted | `#8A7F68` / `#9A8F78` | Meta, captions |
| Muted green | `#64806F` | Secondary icons |
| Success | `#4C7A5A` | In stock |
| Warning | `#D3A73B` | Low stock |
| Danger | `#B85C38` | Sold out, destructive, delete |
| Product tile | `linear-gradient(180deg,#FFFFFF,#F1E9DA)` | Photo backdrop |

### Typography
| Role | Family | Notes |
|---|---|---|
| Display | **Cormorant Garamond** 500/600 | Hero and product names; italic for emphasis; tight tracking (`-0.02em`) at large sizes |
| Section heading | **DM Serif Display** | 34–42px section titles |
| UI / body | **Inter** 400/500/600 | Everything functional |
| Numeric / eyebrow | **DM Mono** 400/500 | Prices, stats, SKUs, uppercase eyebrows (`letter-spacing: .18–.28em`) |

Type scale (desktop): 76 / 52 / 46 / 42 / 40 / 38 / 34 / 26 / 22 / 19 / 17 / 15.5 / 14 / 13 / 11.5px.

### Spacing, radius, shadow
- Spacing: 4 / 6 / 8 / 10 / 12 / 14 / 18 / 22 / 26 / 28 / 36 / 44 / 54 / 60 / 70 / 84 / 92px.
- Radius: 3px (buttons — deliberately sharp for the premium feel), 6px, 8px, 10px, 18px (slider),
  999px (pills), 50% (icon circles).
- Shadows: `0 2px 12px rgba(14,58,42,0.07)` (card), `0 18px 38px rgba(14,58,42,0.18)` (card hover),
  `0 30px 70px rgba(14,58,42,0.18)` (hero image), `0 40px 90px rgba(11,46,33,0.32)` (modal),
  `-18px 0 50px rgba(11,46,33,0.18)` (drawer).

## Assets
All imagery in the prototype is **free-licensed placeholder stock** and must be replaced with the
client's own product photography before launch:
- **Wikimedia Commons** (CC) — rice, mung beans, lentils, chickpeas, flour, sesame macros, and the
  slider's "Rice grains (IRRI)" photo.
- **TheMealDB** — dried fruit, spices, pasta.
- **Unsplash** — lifestyle and hero photography.

Art direction to match when reshooting: **product shots centred on a seamless
white→warm-parchment backdrop**, soft bottom vignette, consistent framing, 1:1 crop.

Icons: **Phosphor Icons** (regular / bold / fill weights) via CDN — swap for the codebase's icon
library, matching weight.

## Files
| File | Contents |
|---|---|
| `SilkGrain Premium.dc.html` | **Primary reference.** All 16 screens + admin, responsive layer, overlays |
| `ProductCardPremium.dc.html` | Product card component |
| `SilkGrain Palettes.dc.html` | Palette exploration — the chosen direction is #3 (emerald + gold) |
| `SilkGrain Directions.dc.html` | 12 rejected art-direction explorations, for context only |

Open the HTML files directly in a browser. In `SilkGrain Premium.dc.html` the dark pill bar at the
top is a **prototype-only screen switcher** — it is not part of the design; ignore it when
implementing. Resize the window past 1024px and 760px to exercise the responsive states.
