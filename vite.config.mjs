import { defineConfig } from "vite";
import { resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, rename, rmdir } from "node:fs/promises";

const root = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(root, "src");

// Custom domain the site is served from (see public/CNAME). Each page's
// canonical and og:url are built from it.
const SITE_URL = "https://ralphlauren.reservebar.com";

// ── Routes ───────────────────────────────────────────────────────────────────
// Pages whose URL differs from their folder: public URL → source page.
//
// A page lives at src/<name>/index.html and is served at /<name>/ unless it
// appears here, so only the homepage needs an entry. This table is the one
// place a page's URL is set; the build, the dev server and the page's canonical
// URL all derive from it.
const ROUTES = {
  "/": "secured/index.html",
};

// The URL a page has when no route claims it: src/faq/index.html → /faq/.
function folderUrl(source) {
  const dir = dirname(source);
  return dir === "." ? "/" : `/${dir}/`;
}

const urlBySource = Object.fromEntries(
  Object.entries(ROUTES).map(([url, source]) => [source, url]),
);

// The URL a page is served at.
function urlFor(source) {
  return urlBySource[source] ?? folderUrl(source);
}

// Where a page is written in dist/: / → index.html, /faq/ → faq/index.html.
function outputPath(source) {
  const url = urlFor(source);
  return url === "/" ? "index.html" : `${url.slice(1)}index.html`;
}

// Folder paths that no longer resolve, because a route serves that page from
// somewhere else: src/secured/index.html is reachable at / only, so /secured/
// redirects there. A folder path that is itself a route still serves a page and
// is left alone.
const routeByVacatedPath = Object.fromEntries(
  Object.entries(ROUTES)
    .map(([url, source]) => [folderUrl(source), url])
    .filter(([vacated, url]) => vacated !== url && !(vacated in ROUTES)),
);

// Every src/**/index.html is its own MPA entry, so a new page needs no config
// change unless it is served somewhere other than its folder (see ROUTES).
// Keys name the page's bundle: src/faq/index.html → assets/faq-<hash>.js.
const pages = Object.fromEntries(
  readdirSync(srcDir, { recursive: true })
    .filter((file) => file.endsWith("index.html"))
    .map((file) => {
      const dir = dirname(file);
      const name = dir === "." ? "main" : dir.replaceAll("/", "-");
      return [name, resolve(srcDir, file)];
    }),
);

function routing() {
  return {
    name: "routing",

    // Serve each page at its routed URL, and mirror GitHub Pages' extensionless
    // paths, so `vite dev` behaves like the deployed site.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const [path, search] = (req.url || "/").split("?");
        const suffix = search ? `?${search}` : "";
        const redirect = (to) => {
          res.statusCode = 301;
          res.setHeader("Location", to + suffix);
          res.end();
        };

        // A routed URL serves its mapped source page.
        const routed = ROUTES[path];
        if (routed) {
          req.url = `/${routed}${suffix}`;
          return next();
        }

        // Bare form of a routed URL takes its trailing slash.
        if (ROUTES[`${path}/`]) return redirect(`${path}/`);

        // A vacated folder path is absent from the build, so point it at the
        // URL its page is served at rather than serving it here.
        const movedTo =
          routeByVacatedPath[path] ?? routeByVacatedPath[`${path}/`];
        if (movedTo) return redirect(movedTo);

        // Unrouted pages: redirect /faq to /faq/ the way Pages does. (Vite's
        // MPA dev server otherwise 404s the no-slash form.)
        const isBarePath =
          path !== "/" &&
          !path.endsWith("/") &&
          !path.includes(".") &&
          !path.startsWith("/@");
        if (isBarePath && existsSync(resolve(srcDir, `.${path}`, "index.html"))) {
          return redirect(`${path}/`);
        }

        next();
      });
    },

    // Point each page's canonical and og:url at the URL it is served at, so
    // they cannot drift from the route table.
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const source = relative(srcDir, ctx.filename).split(sep).join("/");
        const canonical = SITE_URL + urlFor(source);
        return html
          .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${canonical}$2`)
          .replace(
            /(<meta property="og:url" content=")[^"]*(")/,
            `$1${canonical}$2`,
          );
      },
    },

    // Place each page at its routed path in dist/. This works on disk after the
    // write because Rolldown, Vite's bundler, ignores both assignment to
    // `bundle` and a re-emit onto a deleted file name. Pages reference hashed
    // assets by absolute /assets/… paths, so relocating the html rewrites
    // nothing.
    async writeBundle(options) {
      const outDir = options.dir;
      const moves = Object.values(pages)
        .map((page) => relative(srcDir, page).split(sep).join("/"))
        .map((source) => [source, outputPath(source)])
        .filter(([source, to]) => source !== to);

      // Temp names keep two pages that trade URLs from overwriting each other
      // partway through.
      const staged = [];
      for (const [source, to] of moves) {
        const tmp = resolve(outDir, `${to}.routing-tmp`);
        await mkdir(dirname(tmp), { recursive: true });
        await rename(resolve(outDir, source), tmp);
        staged.push([tmp, resolve(outDir, to)]);
      }
      for (const [tmp, to] of staged) await rename(tmp, to);

      // Clear the folder a moved page leaves empty (dist/secured/).
      for (const [source] of moves) {
        const dir = dirname(source);
        if (dir === ".") continue;
        await rmdir(resolve(outDir, dir)).catch(() => {});
      }
    },
  };
}

// Multi-page static site deployed to GitHub Pages on a custom domain
// (ralphlauren.reservebar.com). Source lives in src/; static files (CNAME,
// assets) live in public/ and are copied to the dist/ root on build.
export default defineConfig({
  root: srcDir,
  base: "/",
  // Multi-page app: disable the default SPA fallback so /faq serves
  // faq/index.html instead of falling back to the homepage.
  appType: "mpa",
  plugins: [routing()],
  publicDir: resolve(root, "public"),
  build: {
    outDir: resolve(root, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: pages,
    },
  },
});
