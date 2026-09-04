#!/usr/bin/env node
/**
 * A static file server for the built storefront, and nothing else.
 *
 * Deliberately dependency-free rather than nginx or a framework: this serves one small
 * directory of immutable assets with an index.html fallback, and every dependency it does
 * not have is one that cannot need patching in a container that will outlive our attention.
 *
 * The storefront gets its own service because it must have its own origin. It is a public,
 * anonymous, untrusted page; the console holds an authenticated session. Sharing an origin
 * would put them inside the same security boundary, where a compromised shop page could
 * read the console's CSRF token and act as the analyst.
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const ROOT = resolve(process.argv[2] ?? 'dist');
const PORT = Number(process.env.PORT ?? 5174);

/**
 * Where the API lives, read at start-up rather than baked into the bundle.
 *
 * Vite would happily substitute this at build time, and that was the first design — but it
 * makes the shop's image depend on an address that only exists after the API is deployed,
 * which means a repository cannot simply build and deploy itself. As an environment
 * variable it is one `az containerapp update` away, with no rebuild.
 *
 * Empty means same-origin, which is what the Vite dev proxy provides locally.
 */
const API_BASE_URL = (process.env.API_BASE_URL ?? '').replace(/\/$/, '');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/**
 * Resolves a request path inside ROOT, or null if it escapes.
 *
 * `normalize` collapses `..` before the join, so `/../../etc/passwd` cannot walk out of
 * the served directory — the oldest bug in static file serving.
 */
function resolveWithin(root, urlPath) {
  const candidate = resolve(join(root, normalize(decodeURIComponent(urlPath))));
  return candidate === root || candidate.startsWith(root + sep) ? candidate : null;
}

/**
 * index.html with the runtime configuration injected.
 *
 * Read fresh on each request rather than cached: the file is a few hundred bytes, it is
 * already `no-cache`, and a served-from-memory copy is one more thing that can be stale
 * after a deploy.
 */
function indexWithConfig() {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const config = JSON.stringify({ apiBaseUrl: API_BASE_URL });
  // JSON is injected inside a script tag, so `</script>` appearing in a value would close
  // it early. There is no user input here, but escaping costs nothing and the day someone
  // adds a configurable string is not the day to remember this.
  const safe = config.replace(/</g, '\u003c');
  return html.replace('</head>', `<script>window.__SENTINEL__=${safe};</script></head>`);
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const target = resolveWithin(ROOT, url.pathname);

  const file =
    target !== null && existsSync(target) && statSync(target).isFile()
      ? target
      : join(ROOT, 'index.html');

  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  const isIndex = file.endsWith('index.html');

  // Hashed asset filenames are safe to cache forever; index.html must never be, or a
  // deploy leaves browsers holding a shell that points at assets which no longer exist.
  const cache = isIndex ? 'no-cache' : 'public, max-age=31536000, immutable';

  response.writeHead(200, {
    'content-type': type,
    'cache-control': cache,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
  });

  if (isIndex) {
    response.end(indexWithConfig());
    return;
  }

  createReadStream(file).pipe(response);
});

server.listen(PORT, '0.0.0.0', () => {
  console.warn(
    `storefront serving ${ROOT} on port ${PORT} — api: ${API_BASE_URL === '' ? 'same origin' : API_BASE_URL}`,
  );
});
