// Copies public/ into dist/, placing the site under the secret SITE_PATH
// prefix (a Netlify environment variable) so it is only reachable at
// https://<site>.netlify.app/<SITE_PATH>/. Only robots.txt lives at the root.
import { cpSync, mkdirSync, rmSync, copyFileSync, writeFileSync } from 'node:fs';

const sitePath = (process.env.SITE_PATH ?? '').trim();
if (sitePath && !/^[A-Za-z0-9_-]+$/.test(sitePath)) {
  console.error('SITE_PATH may only contain letters, digits, "-" and "_".');
  process.exit(1);
}
if (!sitePath) console.warn('WARNING: SITE_PATH is not set; the site will be served at the root URL.');
else if (sitePath.length < 24) console.warn('WARNING: SITE_PATH is short; use at least 24 random characters.');

rmSync('dist', { recursive: true, force: true });
const target = sitePath ? `dist/${sitePath}` : 'dist';
mkdirSync(target, { recursive: true });
cpSync('public', target, { recursive: true });
copyFileSync('public/robots.txt', 'dist/robots.txt');
if (sitePath) {
  // Plain 404 at the root instead of revealing anything.
  writeFileSync('dist/404.html', '<!doctype html><meta name="robots" content="noindex, nofollow"><title>Not found</title><p>Not found</p>\n');
}
console.log(`Built site into ${target}/`);
