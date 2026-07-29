# Screen inventory

Distilled from `silkgrain-design-prompt/for adaptive/SilkGrain Premium.dc.html`, which holds
all sixteen screens in one file behind `sc-if` flags. This page exists so implementation work
does not have to re-read a 227 KB prototype; the prototype stays the authority when the two
disagree.

Catalogue content — sixteen products, six categories, their prices and copy — is extracted
verbatim into `catalog.json` by `scripts/extract-design-data.mjs`.

---

## Routes

| Flag          | Screen               | Route                        |
| ------------- | -------------------- | ---------------------------- |
| `isHome`      | Home                 | `/`                          |
| `isShop`      | Catalog with filters | `/shop`                      |
| `isCategory`  | Category landing     | `/shop/c/:slug`              |
| `isProduct`   | Product detail       | `/product/:slug`             |
| `isCart`      | Cart                 | `/cart`                      |
| `isCheckout`  | Checkout             | `/checkout`                  |
| `isConfirm`   | Order confirmation   | `/order/:number`             |
| `isTrack`     | Order tracking       | `/track`                     |
| `isWholesale` | Wholesale enquiry    | `/wholesale`                 |
| `isAbout`     | About                | `/about`                     |
| `isRecipes`   | Recipes              | `/recipes`, `/recipes/:slug` |
| `isFaq`       | FAQ and contact      | `/help`                      |
| `isAccount`   | Customer account     | `/account/*`                 |
| `isWishlist`  | Wishlist             | `/wishlist`                  |
| `isAdmin`     | Admin panel          | `/admin/*`                   |
| `isStates`    | 404 and empty states | system                       |

The dark pill bar at the top of the prototype is its own screen switcher. It is not part of
the design.

---

## Global chrome

**Announcement bar** — `#0B3D2C`, 12px, centred, gold diamond either side:
"Complimentary shipping over $75 · Direct from family farms". Hidden on the admin screen.

**Header** — sticky, `rgba(251,248,242,0.92)` with `backdrop-filter: blur(12px)`, 74px tall,
1px `#E4E0D1` bottom border. Logo left (34px green tile with the `grains` icon, then `silk`
in green and `grain` in gold, Cormorant 600 27px). Nav centre: Shop, Recipes, Wholesale,
About, Help — hover turns gold. Right cluster: search, wishlist, account, cart with a gold
count bubble, then a green "Shop Now" button.

**Mega-menu** — opens on hovering Shop, closes on leaving the header. `#FCFAF4` panel,
`0 30px 60px rgba(11,46,33,0.12)`. Two columns: a 3×2 grid of categories with icon, name and
product count, and a featured Devzira card. On touch this needs a tap-to-open pattern; the
prototype is hover-only.

**Search overlay** — full-width panel from the top. Cormorant 26px input on a 2px `#0E6B4A`
underline, an ESC chip on the right, popular-term chips while empty, then result rows
(thumbnail, name, category, price).

**Cart drawer** — fixed right, 430px, `translateX` over `.5s cubic-bezier(.22,1,.36,1)`.
Header with item count, free-shipping progress bar, scrollable lines, footer with subtotal,
Checkout and "View full cart". Full width on mobile.

**Quick view** — 840px modal, two columns, `0 40px 90px rgba(11,46,33,0.32)`. Category, name,
rating, blurb, weight list, price, "Add to cart" and "Full details". Full width on mobile.

**Mobile nav** — left slide-in, 330px / max 86vw, `.45s cubic-bezier(.22,1,.36,1)`. Rows for
Shop, Recipes, Wholesale, About, Help, Wishlist, My Account, each with an arrow. Footer has a
"Shop the pantry" CTA and the shipping note.

**Footer** — `#0A2E21`, four columns (brand and socials, Shop, Company, Get in touch), bottom
bar with copyright and payment badges rendered as bordered mono text, not logos.

All overlays share one scrim, `rgba(10,35,25,0.44)`; clicking it closes everything.

---

## Home

1. **Featured slider** — contained panel, radius 18px, three 480px slides, auto-advance every
   5500 ms, thin gold indicators bottom-left, glass circle arrows bottom-right. Slides:
   Devzira rice, sun-dried fruit, welcome offer with code `WELCOME10`.
2. **Hero** — two columns `1.02fr 0.98fr`. Gold rule plus mono eyebrow "From Silk Road soil to
   your spoon"; 76px Cormorant 500 headline "Grains of quiet _provenance_" with the second
   word italic and green; paragraph; primary CTA plus an underlined text link; three mono
   stats (40+ named farms, 100% lab-tested, 48h fresh dispatch). Photo has an offset 1px gold
   frame, a `0 30px 70px rgba(14,58,42,0.18)` shadow, a parallax of `scrollY * 0.12`, and a
   floating "12 / Months aged" card bottom-left.
3. **Category strip** — six tiles, icon over label, hover fills green and lifts 3px.
4. **Best Sellers** — eyebrow "Pantry favorites", DM Serif 40px heading, "View All Products"
   link, 4-up product grid.
5. **The Plov Set** — bundle of three products, `$49.00` against `$55.99`, "Save 12% as a set",
   "Add the set". Not in the data model — see BACKLOG.
6. **Values** — three columns on `#E9E5D7`: Direct from Farmers, Lab Tested, Fast US Delivery.
7. **Origin story** — two columns, "From the Heart of the Silk Road", two paragraphs, "Read
   Our Story", and a placeholder map tile.
8. **Wholesale band** — `#0B3D2C` with a gold zig-zag top edge, headline, four use-case icons,
   gold outline CTA.
9. **New Arrivals** — 4-up grid.
10. **Testimonials** — three cards, five gold stars, Cormorant italic 21px quote, initials
    avatar.
11. **Subscribe & Save** — cadence pills and a dark benefits panel. Not in the data model.

---

## Shop

Breadcrumb, "Shop All Grains" in DM Serif 42px, subtitle, then `260px 1fr`.

Sidebar is sticky at `top: 90px`: Filters heading with a terracotta "Reset", then cards for
Categories (checkbox plus count), Price Range (dual-handle slider with two boxed values),
Weight (1/2/5/10/25/50 lb), Origin (Uzbekistan, Turkmenistan, Kazakhstan, Mixed Origin) and
Certifications (Organic, Non-GMO, Halal).

Results bar: "Showing 1–16 of 74 products", a sort control and a grid/list toggle. Then a
3-up product grid and numeric pagination with a Next button.

---

## Category

320px full-bleed photo hero with a `rgba(12,40,29,0.82)` to `.35` gradient, breadcrumb in
light text, 52px DM Serif title, description, mono product count. Below: sub-filter chips
(All Rice, Long-Grain, Red & Brown, Ancient Grains, For Plov), a results bar and a 3-up grid.

---

## Product

Breadcrumb, then `1fr 1fr`.

Left column is sticky: 1:1 image on the white-to-`#F1E9DA` gradient tile, plus four
thumbnails, the active one outlined in green.

Right column: category label and badges, 48px Cormorant name, star row with rating and a
review-count link, blurb, divider, "Select weight" as mono pill buttons, price in 34px mono
with a "per {weight}" suffix and a stock dot, then a quantity stepper beside a full-width
"Add to Cart · {line total}". Below that an outlined "Buy Now", a gold wholesale notice
("Need 25+ lbs?"), a trust row (Secure Checkout, Free Shipping $75+, 30-Day Returns) and a
"Ships from Houston, TX" line.

Tabs: Description (copy plus three serving suggestions), Nutrition Facts (an FDA-style label
in a 300px column beside ingredients and allergens), Origin & Sourcing (region, two
paragraphs, map and farmer placeholders), Reviews (average, five-star histogram, review list,
"Write a Review"). Then "You May Also Like", 4-up.

A sticky add-to-cart bar on mobile is specified in the handoff README but not built in the
prototype.

---

## Cart

`1fr 380px` inside a 1180px container. Left: free-shipping progress card, then line rows
(84px image, category, name, weight and unit price, stepper, line total, delete), then a promo
code row, then "Continue Shopping". Right, sticky: Order Summary with subtotal, shipping, tax,
total, "Proceed to Checkout", an "or pay with" divider and Google Pay, Apple Pay and PayPal
buttons, plus an SSL note.

---

## Checkout

Four-step progress indicator (Cart, Shipping, Payment, Confirmation), then `1fr 400px`.

Left: Contact (email, "No account needed", marketing checkbox), Shipping Address (first and
last name, two address lines, city/state/ZIP as `2fr 1fr 1fr`, phone), Shipping Method (three
radio cards: Standard free, Express $12.99, Overnight $24.99), Payment (Card / PayPal / Apple
Pay / Google Pay tabs, card fields, "Billing address same as shipping").

Right, sticky: item list with quantity bubbles, totals, "Place Order — {total}", "Secured by
Stripe SSL".

---

## Confirmation

Centred, 720px. Green check in a ring, 44px DM Serif thanks, email confirmation line, order
number chip and delivery estimate, an order summary card (items, shipping address, payment
method, totals), "Track Your Order" and "Continue Shopping", then a dark referral band —
"give 10% off, get 10% off". The referral programme is not in the data model.

---

## Track

Dark header card with order number, carrier and arrival window. Then `1fr 360px`: a five-step
timeline (Order Placed, Packed, Shipped, Out for Delivery, Delivered) with green dots for
completed steps, and a sidebar with a map image, shipment contents and a help button.

---

## Wholesale

Dark hero with the gold zig-zag edge, "Partner with SilkGrain", and four stats (500+ partners,
30+ products, 50 lbs minimum, custom packaging). Three benefit cards. Then the enquiry form on
a 880px card: business name, business type, contact name, email, phone, estimated monthly
volume, category chips, message, submit, and "We'll get back to you within 1 business day".

The form has a single contact-name field and no address — see decision D-5.

---

## About

Gradient hero with eyebrow, 54px headline and a lead paragraph. Two-column founder story.
Three value cards on `#E9E5D7`. A dark stats band (2018, 40+, 3, 50k+). Closing CTA pair.
No team section, despite the original brief asking for one.

---

## Recipes

Centred intro, a 380px featured recipe panel with a FEATURED chip and time/level/serves meta,
then a 3-up grid of recipe cards with category chip, Cormorant title, blurb and time/level
footer. There is no detail-page design.

---

## Wishlist

Breadcrumb, title with a saved count, "Add All to Cart", then a 4-up product grid ending in a
dashed "Discover more" tile.

---

## Account

`280px 1fr`. Sticky sidebar with avatar initials, name and email, then Order History, Track
Order, Wishlist, Addresses, Payment Methods, Settings and a terracotta Sign Out. Main column:
three stat cards (total orders, lifetime spend, and a dark "Grain points" card), then order
cards with number, date, status chip, total, Track and Reorder, and item chips.

Grain points, Addresses and Payment Methods have no backing model — see BACKLOG.

---

## Admin

`248px` dark sidebar, `#EEF1EC` canvas. Sidebar: gold logo tile, "SilkGrain / ADMIN", eight
nav items (Dashboard, Products, Orders with badge, Pricing, Wholesale with badge, Customers,
Analytics, Settings), and a user block pinned to the bottom. Top bar: breadcrumb over a DM
Serif page title, search, bell with dot, "Add Product".

**Dashboard** — four KPI cards with a tinted icon tile and a delta chip; a revenue area chart
as inline SVG over 30 points with a green gradient fill; a Low Stock panel with per-item
progress bars; a Recent Orders table.

**Products**, **Orders** and **Wholesale requests** are list views only. The product form,
order detail, wholesale detail, Pricing, Customers, Analytics, Settings and the admin login
have no design — see QUESTIONS.md Q-28.

On mobile the sidebar becomes a horizontally scrolling icon strip and tables scroll inside
their card at a 720px minimum width.

---

## States

A 140px `404` in DM Serif with a gold zero, "This page wandered off the Silk Road", two CTAs.
Below, two designed empty states: empty cart and no search results. The other four the spec
requires (wishlist, orders, wholesale requests, plus 404 variants) are not drawn.
