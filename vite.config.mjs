import { defineConfig } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync } from "node:fs";

const root = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(root, "src");

// Auto-discover every page: each src/**/index.html is its own MPA entry.
// Add a new page by dropping in src/<name>/index.html — no config change needed.
// Keys: the root index.html is "main"; src/faq/index.html is "faq", etc.
const pages = Object.fromEntries(
  readdirSync(srcDir, { recursive: true })
    .filter((file) => file.endsWith("index.html"))
    .map((file) => {
      const dir = dirname(file);
      const name = dir === "." ? "main" : dir.replaceAll("/", "-");
      return [name, resolve(srcDir, file)];
    }),
);

// Dev-only: mirror GitHub Pages behavior by redirecting an extensionless path
// like /faq to /faq/ when src/faq/index.html exists. (In production, Pages does
// this automatically; Vite's MPA dev server otherwise 404s the no-slash form.)
function pagesTrailingSlashRedirect() {
  return {
    name: "pages-trailing-slash-redirect",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || "").split("?")[0];
        const isBarePath =
          url !== "/" &&
          !url.endsWith("/") &&
          !url.includes(".") &&
          !url.startsWith("/@");
        if (isBarePath && existsSync(resolve(srcDir, "." + url, "index.html"))) {
          res.statusCode = 301;
          res.setHeader("Location", url + "/");
          res.end();
          return;
        }
        next();
      });
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
  plugins: [pagesTrailingSlashRedirect()],
  publicDir: resolve(root, "public"),
  build: {
    outDir: resolve(root, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: pages,
    },
  },
});
