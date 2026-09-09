# Ralph Lauren × ReserveBar

A static, multi-page storefront demo that shows Ralph Lauren products being sold
through ReserveBar using [Liquid Commerce](https://liquidcommerce.co) Elements
and the Liquid Commerce cloud SDK.

Deployed to GitHub Pages on a custom domain: **https://ralphlauren.reservebar.com**

The whole site is static HTML, CSS and vanilla JS. There is no backend in this
repo — products, cart, checkout and shopper records all come from Liquid
Commerce services, loaded in the browser from their CDN.

## Pages

| URL | Source | What it is |
| --- | --- | --- |
| `/` | `src/secured/` | **The main site.** Storefront behind an email/password sign-in, which prefills the shopper's saved address, customer info and card at checkout. |
| `/standard/` | `src/standard/` | The same storefront with no sign-in and no prefill — the plain Elements integration. |
| `/create-payment/` | `src/create-payment/` | Companion tool for `/`: fills in the shopper info (profile, address, card) that the secured site prefills at checkout. |
| `/faq/` | `src/faq/` | Static FAQ page. |
| `/old/` | `src/old/` | Superseded iframe/token-based Elements embed, kept for reference. |

All pages are `noindex, nofollow` — this is a demo, not a public catalogue.

## Routing

A page's URL is **not** determined by where its file sits. It comes from the
`ROUTES` table at the top of `vite.config.mjs`:

```js
const ROUTES = {
  "/": "secured/index.html",
};
```

Left is the public URL, right is the source page. Every page lives at
`src/<name>/index.html` and is served at `/<name>/` unless it is listed here, so
only the homepage needs an entry.

That one table drives three things, which is why URLs stay consistent:

- **Build** — the page's HTML is written to its routed path in `dist/`.
- **Dev server** — `/` serves the secured page, and `/secured/` redirects to `/`
  so a path that does not exist in the build cannot quietly work locally.
- **SEO tags** — each page's `canonical` and `og:url` are rewritten to the URL
  it is actually served at, so they cannot drift.

### Changing which site is the homepage

Edit the one line. To put the ungated site back on `/`:

```js
const ROUTES = {
  "/": "standard/index.html",
};
```

Nothing moves on disk. If you want the secured site to remain reachable, give it
its own entry (`"/secured/": "secured/index.html"`) or just leave it out and it
will be served at `/secured/` by default.

### Adding a page

Drop in `src/<name>/index.html` (plus a `main.js` if it needs one). It is picked
up automatically as its own entry and served at `/<name>/` — no config change
unless you want it somewhere else.

Reference scripts and styles by absolute path from the site root, e.g.
`<script type="module" src="/<name>/main.js">` and
`<link href="/styles/main.css" rel="stylesheet">`.

## Local development

Requires Node 22 and pnpm 10.

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # → dist/
pnpm preview    # serve the built dist/
```

`pnpm dev` mirrors production routing, including trailing-slash redirects, so
what you see locally is what Pages serves.

## Deployment

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every
push to `master` (and on manual dispatch). `public/` is copied to the `dist/`
root, which is how `CNAME` and `assets/` reach the deployed site. `dist/` is
gitignored — never commit build output.

## How the storefront works

Pages pull in the Liquid Commerce scripts via `<script src>` tags and then drive
them from their own `main.js`:

- **Elements** — the embeddable product, address, cart and checkout UI, served
  from a ReserveBar Cloudflare Worker
  (`elements.reservebar-worker.workers.dev/rahl/all/elements.js`).
  `window.LiquidCommerce.Elements(key, opts)` returns a client;
  `injectProductElement()` fills a per-product placeholder div, and
  `injectAddressElement()` / `ui.cartItemsCount()` wire up the header.
  Loaded by `/` and `/standard/`.
- **cloud SDK** — the data API, served from
  `storage.googleapis.com/liquid-commerse-assets/sdk/cloud/`.
  `window.LiquidCommerce(key, opts)` returns a client used for shopper records
  (`user.session`, addresses, saved payments). Loaded by `/`, `/standard/` and
  `/create-payment/`.

The two storefront pages each render their own product cards from a `PRODUCTS`
array of `GROUPING-*` identifiers, with matching images in
`public/assets/imgs/`. The cards deliberately hide Elements' own
title/image/description (`customTheme.product.layout`) so the surrounding Ralph
Lauren layout provides them, and leave an empty `content-<identifier>` node for
Elements to inject the buy controls into.

`/faq/` loads no third-party scripts. `/old/` uses the earlier
`liquid-elements.js` + tokenised iframe approach and is unrelated to the
current integration.

### The secured page (`/`) and create-payment, together

These two pages are one feature. `/` signs a shopper in and prefills their
checkout; `/create-payment/` is where that shopper's details come from.

**Sign-in credentials live in the backend, not in this repo and not in
create-payment.** The email/password pairs are configured on the
`elements-services` side; the page only asks whether a submitted pair is valid.

How `/` behaves:

1. A sign-in overlay collects email + password and posts them to
   `elements-services` `/api/other/verify-rl-user`, which answers
   `{ valid: boolean }`.
2. On success the storefront renders and Elements boots.
3. `user.session({ email })` looks the shopper up in the cloud **by that same
   email**, and the page prefills the storefront address immediately, then — on
   the `lce:actions.checkout_loaded` event — the checkout's customer info and
   saved card.

`/create-payment/` is a four-step flow — email lookup → profile → address →
payment — that creates or updates the shopper record step 3 reads: name, phone,
birth date, address and a saved card. It does **not** create or change a
password; it has nothing to do with signing in. Card capture uses the standalone
`LiquidCommercePaymentElement` factory with `createConfirmationToken()` and
`confirmPaymentSession()`.

> **The email is the join between the two.** Whatever email you enter in
> create-payment must be the same email that is configured with a password in
> the backend. Sign in at `/` with a backend-configured email that has no
> matching shopper record and the gate opens, but there is nothing to prefill —
> the console logs `No cloud user found for <email>`.

**The gate is a demo affordance, not access control.** Verification happens in
the browser and the page's JS is public, so treat everything here as public.

## Configuration

Each entry point holds its own config constants at the top of its `main.js`:

| Constant | Meaning |
| --- | --- |
| `ELEMENTS_API_ENV` | Elements environment. `production` or `staging`. |
| `ELEMENTS_API_KEY` | Publishable Elements key (`pk_…`). |
| `CLOUD_API_ENV` | Cloud SDK environment (`prod`). |
| `CLOUD_API_KEY` | Cloud SDK key. |
| `ELEMENTS_SERVICES_BASE` | Per-env base URL for `elements-services`, picked by `ELEMENTS_API_ENV`. |
| `GOOGLE_PLACES_API_KEY` | Browser key for address autocomplete on create-payment. |

These are all client-side keys and ship in the bundle. **Do not put a secret in
this repo** — anything here is readable by anyone who loads the page. The Google
Places key should be HTTP-referrer restricted to the site's domains.

## Styling

Tailwind (v3) compiled through PostCSS, with the entry stylesheet at
`src/styles/main.css` and custom `LeJeuneDeck` / `FoundersGrotesk` faces loaded
from `public/assets/fonts/`. The content glob is `./src/**/*.{html,js}`, so
classes are picked up from any page without configuration.

## Repo layout

```
src/
  secured/         storefront behind sign-in, served at /
  standard/        ungated storefront, served at /standard/
  create-payment/  shopper info + card for the secured site
  faq/             static FAQ
  old/             superseded embed, kept for reference
  styles/main.css  Tailwind entry
public/            copied to dist/ root (CNAME, imgs, fonts)
vite.config.mjs    routing table + build/dev/SEO wiring
```
