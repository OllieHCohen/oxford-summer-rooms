# Oxford Summer Rooms — Project Handoff / Brain Dump

_Last updated: 2026-06-09. Read this first if you're picking the project up in a new session._

---

## 1. What this is
A public, Airbnb-style website — **OxfordSummerRooms.com** — that lists Oxford student
rooms available for short summer lets, and takes a **£100 refundable holding deposit**
(via Stripe) to reserve a room. It was rebranded from an earlier "Regalis Property"
holding page. All property data is **read** from a Supabase backend; bookings are
**written** to an OSR-only table via edge functions.

- **Live site:** https://www.oxfordsummerrooms.com (Vercel, auto-deploys from GitHub `main`)
- **GitHub:** https://github.com/OllieHCohen/oxford-summer-rooms (account `OllieHCohen`)
- **Local working copy:** `/Users/olivercohen/Library/Mobile Documents/com~apple~CloudDocs/claude-brain/oxford-summer-rooms` (iCloud)
- **Vercel project:** `oxford-summer-rooms` (signed in as `olliehcohen`); aliases `www.oxfordsummerrooms.com`
- Owner: Oliver Cohen (ohc@ohcgroup.com)

## 2. Tech / architecture
- **Plain static site, no build step.** Just HTML + one shared CSS + one shared JS.
- **Hosting:** Vercel. Deploy with `npx vercel --prod --yes` (also auto-deploys on git push).
- **Backend:** Supabase (read-only from the browser via the public anon key). Booking
  writes + Stripe go through OSR edge functions (service role).
- No framework, no bundler. Edits are direct to the files.

### Files
| File | Purpose |
|---|---|
| `index.html` | **Properties** page: hero, trust pills, "How it works" + "What do I get?" modals, property cards (left) + **interactive Google map** (right) |
| `property.html?id=<buildingId>` | **Rooms** page: property header (address, pills), room cards, location map. Each room has "Book this room →" |
| `book.html?property=<id>&room=<id>` | **Booking** page: date picker (constrained to availability), price summary, billing form, £100 Stripe deposit |
| `book-success.html?session_id=...` | Post-payment confirmation |
| `common.js` | Shared: Supabase config + helpers, lightbox (click-to-zoom), carousel, card builders, footer + Rent Guru logo injection, the 3 modals (How it works / What do I get / Book a Viewing), `PAYMENTS_ENABLED` flag, function URLs (`BOOKING_FN`/`ADDRESS_FN`/`VIEWING_FN`) |
| `styles.css` | All styles |
| `rent-guru-logo.png`, `favicon.svg`, `oxford-summer-rooms-logo.svg`, `safari-pinned-tab.svg`, `site.webmanifest` | assets |
| `supabase/` | OSR edge functions + SQL + this backend's README |
| `licences/` | **gitignored (guest PII)** — Word Licence-to-Occupy docs: robust template + filled per-guest copies (see §8) |

## 3. Supabase backend — ⚠️ SHARED PROJECT, READ THIS
- **Project ref:** `rmoqgbrttdbgxntbxaxr` ("Amber.rent Database project"), region London.
- **This project ALSO hosts The Rent Guru's production functions** (create-booking,
  cancel-booking, calendar-availability, static-map, etc.). The Supabase CLI on this
  machine is logged in and can deploy/edit ALL of them.
- 🚨 **NEVER deploy a function or create a table whose name isn't `osr-`/`osr_`-prefixed.**
  Earlier in this project a function named `create-booking` was deployed and it
  **overwrote Rent Guru's production `create-booking`** (a ~800-line function). Oliver
  had to rebuild it. Do not repeat this. Always namespace OSR resources.
- **URL:** `https://rmoqgbrttdbgxntbxaxr.supabase.co`
- **Anon key (public, read-only — safe in frontend, it's in `common.js`):**
  `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJtb3FnYnJ0dGRiЗ3hudGJ4YXhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc0NzM1NjEsImV4cCI6MjA1MzA0OTU2MX0.Ps1dT9HtOBVzNbiUikzSCWsBhHfg1_2tTevUB7gaL2c`
  (anon key is also printed correctly in `common.js` — copy from there to avoid typos.)

### Tables we READ (do not write)
- `property_live_status` — publish gate. Only show where `is_live = true`. Also has
  `hero_image_url` / `hero_image_sort` / `hero_image_title` (per-property main-photo override).
- `summer_void_properties` — buildings (property_id, property_address, city, role,
  preceding_agreement_end, start_date).
- `summer_void_members` — rooms inside each building (void_property_id → building, property_id = room).
- `bannits_property_cache` — full detail + `images` jsonb (type = Photos/Floorplans/Videos),
  `rent_per_month`, beds/baths, and `payload` jsonb with `latitude`/`longitude`/`usp1..3`/`shortDescription`.
- `room_availability` — bookable date windows per room (already accounts for the gap/buffers/existing bookings).
- `summer_voids_sync_log` — `finished_at` for the "availability as of" note.

### OSR resources WE own (safe to edit/redeploy)
- **Table `osr_bookings`** — bookings (RLS on, no public policies; only the edge functions touch it).
  SQL is in `supabase/osr_bookings.sql`. (It was created by renaming an earlier `bookings` table.)
- **Function `osr-create-booking`** — validates server-side (live status, room membership,
  availability window, 14-night min, date clash), creates a £100 Stripe Checkout session,
  inserts a `pending_payment` row. Returns `{ url }`. Frontend redirects to it.
- **Function `osr-stripe-webhook`** — on `checkout.session.completed` marks the row
  `reserved` + sends Telegram + email; on `expired` marks `cancelled`.
- **Function `osr-static-map`** — Google Static Maps proxy (multi-marker) used as the
  homepage map **fallback** (keeps the Google key server-side).
- **Function `osr-address-lookup`** — Postcoder UK + international address-lookup proxy (key
  server-side). Called by the booking billing-address "Find your address". `?q=<postcode>&country=<UK|FR|US|…>`.
- **Function `osr-book-viewing`** — saves a viewing request to `osr_viewings`, computes the next
  4pm slot (Mon–Fri, UK time; today if weekday & before 3pm, else next weekday), alerts
  mail@therent.guru by Telegram + email.
- **Table `osr_viewings`** — viewing requests (RLS on, no public policies). SQL in `supabase/osr_viewings.sql`.
- Deploy any of them with:
  `supabase functions deploy <name> --project-ref rmoqgbrttdbgxntbxaxr --no-verify-jwt`

### Supabase secrets (set on the project; NOT in git)
- `STRIPE_SECRET_KEY` = **live** `sk_live_…` (Oliver's existing Rent Guru Stripe account)
- `STRIPE_WEBHOOK_SECRET` = `whsec_…` (from the Stripe webhook endpoint)
- `SITE_URL` = `https://www.oxfordsummerrooms.com`
- `GOOGLE_MAPS_API_KEY` = server key used by `static-map` and `osr-static-map`
- `POSTCODER_API_KEY` = Postcoder address-lookup key (used by `osr-address-lookup`).
  Postcoder phone/autocomplete products are NOT enabled on this key.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `RESEND_API_KEY` (pre-existing, reused)
- `BOOKINGS_FROM_EMAIL` (optional; defaults to `bookings@email.therent.guru`)

## 4. Booking & payments (LIVE)
- **`PAYMENTS_ENABLED = true`** in `common.js`. Real £100 charges happen.
- Flow: book.html submit → POST to `osr-create-booking` → returns Stripe Checkout URL →
  browser redirects → guest pays £100 → Stripe redirects to `book-success.html` →
  `osr-stripe-webhook` marks the `osr_bookings` row `reserved`.
- **Stripe is LIVE (not test mode)** — it's Oliver's long-standing Rent Guru account.
  Test = a real £100 charge you then **refund** in Stripe (Payments → Refund). No test cards.
- **Stripe webhook endpoint** (Stripe dashboard, Live mode) points at
  `https://rmoqgbrttdbgxntbxaxr.supabase.co/functions/v1/osr-stripe-webhook`,
  events `checkout.session.completed` + `checkout.session.expired`.
- **Apple Pay / Google Pay** work automatically on Stripe Checkout (enabled on the account;
  only appear on supporting devices/browsers).
- The £100 is framed as **"goes towards your rent, fully refundable if the room isn't right."**
- **Cleaning fee removed** (was £100; `CLEANING_FEE = 0` in common.js and 0 in the function).
- **Notifications on completed booking:** Telegram alert + email via Resend
  **to `mail@therent.guru`, cc `ohc@ohcgroup.com`**, from `bookings@email.therent.guru`
  (the verified Resend subdomain).
- ⚠️ There may be leftover **SMOKETEST** rows in `osr_bookings` (fake guest "SMOKETEST DeleteMe")
  from no-charge tests — safe to delete in the Table Editor.

## 5. Maps
- **Homepage map = interactive Google Maps JavaScript API.** Browser key is in `index.html`:
  `GMAPS_KEY = 'AIzaSyAvM-20zmkc4LMxfoqITtHC7V-6BAXv1eg'`. It must be **HTTP-referrer
  restricted** to `oxfordsummerrooms.com` (that's what protects a public browser key).
  If restricted, the map only works on the live domain (preview/*.vercel.app falls back to static).
- Big red pins; click a pin → info window (photo, address, from £/week, "See the rooms").
  Centered between the properties and Oxford city centre (Carfax).
- Falls back to `osr-static-map` (Google static image) if the JS API can't load.
- **Property detail page** location map uses the Rent Guru `static-map` proxy (single point) —
  that's a Rent Guru function; don't modify it.

## 6. Current state of the site (features built)
- Properties listing (left cards / right map), responsive.
- Property/rooms page: address + meta + green pills (bills, Free Wifi, USPs), room cards, location map.
  Room cards show ONE main photo (intentionally — backend sometimes has wrong photo counts);
  the photo is **clickable → opens large in lightbox with click-to-zoom (2.5×) + pan**.
- Booking page with availability-constrained dates, live price summary, billing address, Stripe.
- **Address lookup** on the booking billing address — Postcoder UK + international (country
  dropdown → postcode → pick → autofill) via `osr-address-lookup`; manual entry always works.
- **Phone validation** on the booking Mobile field — `intl-tel-input` + libphonenumber (flag/dial-code
  picker, format validation, stores E.164). Free, loaded from CDN. Users type the number normally
  (leading 0 is fine; the country code is preselected).
- **"Book a Viewing"** — big green button above the homepage property grid and on each rooms page.
  Opens a reusable modal (`[data-viewing-open]`, set `data-vprop-id`/`data-vprop-addr` on the
  trigger) showing the next 4pm slot + name/email/mobile/notes (notes mentions a virtual WhatsApp
  viewing). Saves to `osr_viewings`, alerts mail@therent.guru. Homepage default property = 13 James St (207).
- Modals: **"✨ How it works"**, **"🎁 What do I get?"**, **"📅 Book a Viewing"** — reusable via
  `[data-hiw-open]` / `[data-wdig-open]` / `[data-viewing-open]`.
- **Contact:** phone/WhatsApp = **07735 939676** (`wa.me/447735939676`). Green WhatsApp button at the
  top of the homepage hero; phone + WhatsApp in the footer (The Rent Guru company block).
  Rent Guru logo top-right (links to homepage), hidden on the rooms page.
- Properties live = whatever is `is_live` in `property_live_status` (toggle there, no code change).
  As of 2026-06-09: **207 (13 James Street)** is the focus; **196 (44 Bullingdon Road)** is being
  taken down (almost fully let).

## 7. Deploy workflow (Oliver's standing instruction: always do this, don't ask)
1. Edit files.
2. `git add -A && git commit` (commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`).
3. `git push`.
4. `npx vercel --prod --yes` (deploys to production, aliases the domain).
5. For backend changes: `supabase functions deploy osr-<name> --project-ref rmoqgbrttdbgxntbxaxr --no-verify-jwt`.
- Secrets / DDL (`osr_bookings.sql`) are run by Oliver in the Supabase dashboard (no DB password locally).

## 8. Licence-to-Occupy documents
- Live in `licences/` (gitignored — guest PII). Word files: a robust **template**
  (`Licence-to-Occupy-TEMPLATE.docx`) + filled per-guest copies (e.g. `…Alheri-Garba.docx`, `…Charles-Lobo-Clarke.docx`).
- **It is a licence, not a tenancy** — drafted as managed serviced short-stay accommodation (no
  exclusive possession, retained access, room substitution, temporary purpose + main home elsewhere)
  to sit outside the Housing Act 1988 / assured-tenancy (Renters' Reform) regime.
- **Licensor** = Home UK (SCL) Ltd, 84 Cathedral Road, Cardiff CF11 9LN; **agent** = Bannits Ltd t/a
  The Rent Guru. Move-in 4pm, out 11am. Charge = £/week **pro-rated** for the period, paid in full on
  arrival (less the £100 already paid online); payment to the Bannits/Wise account. Includes a **House Rules annex**.
- **To fill the template:** replace the `[bracketed]` fields (each a single contiguous text node) via a
  small Python `zipfile` edit of `word/document.xml`, then drop the "TEMPLATE" note table. PDF needs
  LibreOffice/Word (not installed here) — export PDF / e-sign from Word.
- Operational/legal docs — recommend a one-off **solicitor review** of the template.

## 9. Open items / ideas not yet done
- Add a one-click **refund-deposit** helper (currently refund via Stripe dashboard).
- Booking page could show the actual booked room/dates on `book-success.html` (needs a small
  read-only lookup function, since `osr_bookings` is private).
- Periodic backup/export of `osr_bookings` (data isn't in git).
- Confirmation-page content (Oliver wanted to add items — copy still TBD).
- Some 207 rooms have only 1 photo in the backend (data, not a bug).
- Pin colour currently vivid red (`#ff385c`) — change to brand green/navy if preferred.

## 10. Gotchas
- The Supabase project is SHARED with Rent Guru — **OSR-prefix everything**, never overwrite.
- The anon key is read-only; the `bookings`-style table is private (RLS) — only edge functions read/write it.
- Secrets are never committed. Live Stripe secret key only lives in Supabase secrets.
- `supabase/.temp` is gitignored (CLI scratch).
