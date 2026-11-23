// Local preview with the fake fixture rows: node scripts/serve.mjs
// Serves public/ and answers /api/<tab> from public/fixtures/<tab>.csv,
// so no real sheet (and no real addresses) are needed for development.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const port = Number(process.env.PORT) || 8080;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.csv': 'text/csv', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' };

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const api = path.match(/^\/api\/(flats|interest-lists)$/);
  if (api) path = `/fixtures/${api[1]}.csv`;
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join('public', path));
  if (!file.startsWith('public')) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': `${types[extname(file)] ?? 'application/octet-stream'}; charset=utf-8`, 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => console.log(`Fixture preview on http://localhost:${port}/`));
