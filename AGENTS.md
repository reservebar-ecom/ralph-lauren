# AGENTS.md

Working notes for coding agents on this repo. See `README.md` for the full
picture; this file is the short version plus the things that are easy to get
wrong.

## What this is

A static multi-page storefront demo (Ralph Lauren × ReserveBar) built with Vite
and Tailwind, deployed to GitHub Pages at `ralphlauren.reservebar.com`. Plain
HTML + vanilla JS, no framework, no backend in this repo. Products, cart,
checkout and shopper data come from Liquid Commerce scripts loaded in the
browser.

## Commands

```bash
pnpm install
pnpm dev        # dev server, mirrors production routing
pnpm build      # → dist/
pnpm preview    # serve the built dist/
```

pnpm only — there is a `pnpm-lock.yaml` and CI runs `--frozen-lockfile`. Node 22.
No test suite and no linter; verify changes by building and by loading the
affected page.

## Pages

| URL | Source |
| --- | --- |
| `/` | `src/secured/` — storefront behind a sign-in, prefills checkout |
| `/standard/` | `src/standard/` — same storefront, ungated, no prefill |
| `/create-payment/` | `src/create-payment/` — companion to `/`; fills in the shopper info it prefills |
| `/faq/` | `src/faq/` |
| `/old/` | `src/old/` — superseded embed, reference only |

## Routing: edit the table, do not move files

URLs come from the `ROUTES` table at the top of `vite.config.mjs`, not from
where files sit:

```js
const ROUTES = {
  "/": "secured/index.html",
};
```

A page lives at `src/<name>/index.html` and is served at `/<name>/` unless
listed. To change which page is the homepage, edit that one line — **do not
relocate directories to change a URL.** The table drives the build output path,
the dev server, and each page's `canonical`/`og:url`.

Consequences worth knowing:

- `canonical` and `og:url` in the HTML source are **overwritten at build time**
  from `ROUTES`. Editing them in the HTML has no effect; change the route
  instead. `src/secured/index.html` carries a comment saying so.
- The `writeBundle` hook moves page HTML on disk after the write. That is
  deliberate: Rolldown (Vite 8's bundler) ignores both assignment to `bundle` in
  `generateBundle` and a re-emit onto a just-deleted filename, so the obvious
  `bundle[to] = chunk` refactor silently drops pages. Leave it alone.
- The temp-name staging in that hook is what makes two pages trading URLs safe.
  It looks redundant under a single-route table; keep it.

## Conventions

- **Absolute paths from the site root** for anything the browser fetches:
  `/styles/main.css`, `/standard/main.js`, `/assets/imgs/GROUPING-1234.png`.
  A page's own script path must match its source folder, since Vite resolves it
  relative to `src/`.
- **One `main.js` per page**, self-contained. Pages intentionally do not share
  modules; `src/secured/main.js` and `src/standard/main.js` overlap by design.
  Do not refactor them into a shared module without being asked — they are meant
  to be readable in isolation as integration examples.
- **Config constants at the top of each `main.js`**, in a `── Config ──`
  section. Files are organised into those banner-comment sections; follow the
  existing rhythm and comment density, which explains *why* rather than *what*.
- **Static assets go in `public/`**, which is copied to the `dist/` root. That
  is how `CNAME` gets deployed.
- **`dist/` is gitignored.** Never commit build output.
- Tailwind's content glob is `./src/**/*.{html,js}`; new pages need no config.

## Gotchas

- **Keys in source are client-side and public** (`ELEMENTS_API_KEY`,
  `CLOUD_API_KEY`, `GOOGLE_PLACES_API_KEY`). Never add a real secret to this
  repo — everything here ships in the bundle.
- **`ELEMENTS_SERVICES_BASE` has `staging` and `production` only.** The
  development environment was removed; do not reintroduce a `development` entry
  or a `customApiUrl` override.
- **`/` and `/create-payment/` are one feature, joined by the email.** Sign-in
  credentials are configured in the backend (`elements-services`) — not in this
  repo and not by create-payment, which only writes shopper info (profile,
  address, card) and never touches a password. The email entered in
  create-payment must match a backend-configured email, or sign-in succeeds with
  nothing to prefill (`No cloud user found for <email>` in the console). Do not
  document or change create-payment as if it managed credentials.
- **The sign-in gate is not access control.** Verification happens in the
  browser against `/api/other/verify-rl-user` and the page's JS is public. Do
  not describe it as securing anything.
- **Birth dates need converting.** The cloud API returns ISO
  (`1990-01-01T00:00:00.000Z`); the Elements checkout birthdate input validates
  `MM/DD/YYYY` and stays disabled otherwise. `toElementsBirthDate()` in
  `src/secured/main.js` handles this — reuse that shape if you touch it.
- **Checkout prefill must wait for the event.** Customer info and saved payment
  can only be set inside a `lce:actions.checkout_loaded` listener; the address
  can be set as soon as the client is ready.
- **Elements' own product chrome is hidden on purpose**
  (`customTheme.product.layout` sets `showTitle`/`showImages`/`showDescription`
  to false) because the page supplies the layout. Each card leaves an empty
  `content-<identifier>` node for Elements to inject into.
- **`package.json` has no `main` field, deliberately.** This is a site, not a
  package; entries come from `rollupOptions.input` in `vite.config.mjs`. Do not
  add one back.

## Deployment

Push to `master` triggers `.github/workflows/deploy.yml`, which builds and
publishes `dist/` to GitHub Pages. Do not commit or push unless asked.
