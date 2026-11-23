# Flat tracker

A read-only, phone-first website that shows every flat we are looking at as simple cards. All data lives in one Google Sheet; the site only reads it. There is no login, no editing and no write path.

- Plain HTML, CSS and JavaScript in `public/`. No framework, no dependencies.
- A small Netlify Function (`netlify/functions/sheet.mjs`) proxies the sheet as CSV.
- Every page says `noindex, nofollow`, and the URL is not shared publicly or submitted to search engines.

## How the site reads the sheet

**Chosen option: Netlify Function proxy over the published CSV.**

Each sheet tab is published to the web as CSV. The published URLs are stored only in Netlify environment variables. The page calls `api/flats` and `api/interest-lists` on its own origin, and the function fetches the CSV from Google server-side. So the sheet URL is never in this repository and never in the JavaScript sent to the browser.

Freshness: the page fetches both tabs on every load, and the refresh button in the top right fetches again. Neither the browser nor the function caches the data (`Cache-Control: no-store`). Google itself can lag a few minutes behind edits in the published CSV, so a change may take up to about 5 minutes to show.

## Setup (to do by hand)

These steps are not automated. Nothing here creates the Google Sheet, the Drive folder or the Netlify site.

1. **Create the Google Sheet** with two tabs, `Flats` and `Interest lists`, using the exact headers below in row 1.
   Tip: select all columns and choose *Format > Number > Plain text*, so dates such as `2026-11-27 18:00` stay exactly as typed and are not reformatted by Sheets.
2. **Publish each tab as CSV**: *File > Share > Publish to web*, pick the tab, pick *Comma-separated values (.csv)*, publish. Do this once per tab and copy both URLs (they look like `https://docs.google.com/spreadsheets/d/e/2PACX-…/pub?gid=…&single=true&output=csv`).
   Keep the sheet itself shared only with the people who edit it. Do not put it in a public Drive folder.
3. **Connect the repo to Netlify** (the settings come from `netlify.toml`, nothing to fill in; there is no build step).
4. **Set the environment variables** in Netlify (*Site configuration > Environment variables*), scope *Functions* (or *All scopes*):

   | Variable | Value |
   | --- | --- |
   | `FLATS_CSV_URL` | Published CSV URL of the `Flats` tab. |
   | `INTEREST_LISTS_CSV_URL` | Published CSV URL of the `Interest lists` tab. |

5. **Redeploy** (*Deploys > Trigger deploy*), then open `https://<site-name>.netlify.app/` and bookmark it. Do not submit it to search engines.

## Add to home screen

The site is an installable web app (`manifest.webmanifest`, icons in `public/icons/`, service worker `sw.js`).

Tap **Install app** in the top bar (`public/install.js`):

- **Android (Chrome, Edge, Samsung Internet):** opens the browser's own install prompt. The button shows only once the browser offers it.
- **iPhone / iPad:** iOS has no install prompt, so the button shows the steps (Share > *Add to Home Screen* > *Add*).
- The button is hidden when the site is already opened from the home screen.

Without the button: on iPhone use Share > *Add to Home Screen*; on Android use the browser menu > *Install app*.

It opens full screen with its own icon. The service worker keeps:

- **The app itself** (HTML, CSS, JS, icons), network first, so it still opens without a connection and a new deploy shows on the next load.
- **Photos**, cache first: each photo is downloaded from Google Drive once and then served from the phone. The last 300 photos are kept. A photo that fails to load is dropped from the cache.
- **Not the sheet data.** `api/…` is never cached, so the cards are always current.

## Not indexable

- `<meta name="robots" content="noindex, nofollow">` on the page.
- `robots.txt` disallows all crawlers.
- `X-Robots-Tag: noindex, nofollow` header on every response (`netlify.toml`, and on the function responses).
- `Referrer-Policy: no-referrer`, so the site URL is not leaked to listing sites, Google Maps or Drive when a link or photo is opened.

## Sheet schema

Row 1 is the header. Empty rows are skipped. Headers are matched exactly (case-insensitive), so keep the snake_case names.

**Flats**

```
id,status,closed_reason,address,area,map_link,rooms,m2,gross_rent,net_rent,nebenkosten,floor,start_date,listing_links,source,agent_name,agent_contact,date_contacted,last_reply,next_step,viewing_datetime,doorbell,photo_links,pros,cons,notes,last_updated
```

- `status`: `requested viewing`, `viewing booked`, `viewed`, `applied`, `interest list`, `closed`.
- On the homepage, active flats are grouped by status (viewing booked first, then requested viewing, viewed, applied, interest list). Each card shows a date next to the status badge, and each group is sorted by it:
  - `requested viewing`: `date_contacted`, newest first.
  - `viewing booked`: `viewing_datetime`, soonest first.
  - `viewed`: `viewing_datetime`, newest first.
  - `applied`, `interest list`, `closed`: `last_updated`, newest first.
  Flats without that date go to the end of their group.
- `closed_reason`: `we declined`, `no reply`, `skipped`, `scam`, `listing gone`, `rented to someone else`.
- Dates are `YYYY-MM-DD`, date-times are `YYYY-MM-DD HH:MM`, all in Europe/Zurich local time.
- Rents are numbers only (no `CHF`).
- `listing_links` and `photo_links` hold several URLs separated by a newline or `|`. The first photo is the card thumbnail.

**Interest lists**

```
id,name,area,link,status,date_registered,renewal_date,notes,last_updated
```

- `status`: `registered`, `waiting`, `renewal due`, `closed`.

## Photos

Store direct image URLs in `photo_links`, not the Drive folder URL. For a Drive file `https://drive.google.com/file/d/FILE_ID/view`, use `https://drive.google.com/thumbnail?id=FILE_ID&sz=w2000`.

If an image fails to load, the site tries `https://lh3.googleusercontent.com/d/FILE_ID=w2000` and then `https://drive.google.com/uc?export=view&id=FILE_ID`. If all fail, the photo is treated as missing (no placeholder image).

## Local development

Requires Node 18 or newer. No install step.

```
npm run dev
```

Opens a preview on http://localhost:8080/ that answers `api/flats` and `api/interest-lists` from the fake rows in `public/fixtures/`. No real sheet or real address is needed.

On a deployed site, add `?fixtures` to the URL (e.g. `https://<site>/?fixtures`) to view the same fake rows instead of the sheet, which is handy before the sheet exists.

The fixture rows are fake examples. Do not copy them into the real sheet.

## Privacy

Never commit or put into the sheet, Drive folder names or the site: personal phone numbers, IBANs or other payment details, or ID, passport or permit numbers. Flat addresses and agent contacts are expected, which is why the site URL should not be shared publicly. The sheet URLs live only in Netlify environment variables.
