// Proxies one tab of the Google Sheet as CSV so the sheet URL never reaches
// the repo or the browser. Sheet URLs live in Netlify environment variables.
//
//   GET /<SITE_PATH>/api/flats           -> FLATS_CSV_URL
//   GET /<SITE_PATH>/api/interest-lists  -> INTEREST_LISTS_CSV_URL
//
// When SITE_PATH is empty the API is served at /api/<tab> instead.

const TABS = {
  'flats': 'FLATS_CSV_URL',
  'interest-lists': 'INTEREST_LISTS_CSV_URL',
};

const env = (name) => (globalThis.Netlify?.env?.get(name) ?? process.env[name] ?? '').trim();

const reply = (status, body, type = 'text/plain; charset=utf-8') => new Response(body, {
  status,
  headers: {
    'content-type': type,
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow',
    'referrer-policy': 'no-referrer',
  },
});

export default async (req, context) => {
  const secret = context.params?.secret ?? '';
  if (secret !== env('SITE_PATH')) return reply(404, 'Not found');

  const varName = TABS[context.params?.tab];
  if (!varName) return reply(404, 'Not found');

  const url = env(varName);
  if (!url) return reply(503, `${varName} is not set in Netlify environment variables.`);
  if (!/^https:\/\//.test(url)) return reply(500, `${varName} must be an https URL.`);

  let upstream;
  try {
    upstream = await fetch(url, { redirect: 'follow', headers: { accept: 'text/csv' } });
  } catch {
    return reply(502, 'Could not reach Google Sheets.');
  }
  const type = upstream.headers.get('content-type') ?? '';
  if (!upstream.ok || type.includes('text/html')) {
    // An HTML response usually means the tab is not published or not shared.
    return reply(502, `Google Sheets returned ${upstream.status}${type.includes('text/html') ? ' (HTML, not CSV: is the tab published as CSV?)' : ''}.`);
  }
  return reply(200, await upstream.text(), 'text/csv; charset=utf-8');
};

export const config = {
  path: ['/api/:tab', '/:secret/api/:tab'],
};
