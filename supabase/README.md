# Oxford Summer Rooms — booking backend (OSR-namespaced)

Everything here is **OSR-only** and must never collide with Rent Guru resources:
- Table: **`osr_bookings`**
- Functions: **`osr-create-booking`**, **`osr-stripe-webhook`**
- The functions only **read** the shared tables (`property_live_status`,
  `summer_void_members`, `room_availability`, `bannits_property_cache`) and only
  **write** `osr_bookings`.

Project ref: `rmoqgbrttdbgxntbxaxr`.

## 1. Table
In the SQL editor, either rename the earlier OSR table:
```sql
alter table public.bookings rename to osr_bookings;
```
…or create it fresh with [`osr_bookings.sql`](./osr_bookings.sql).

## 2. Deploy the functions
```bash
supabase functions deploy osr-create-booking --project-ref rmoqgbrttdbgxntbxaxr --no-verify-jwt
supabase functions deploy osr-stripe-webhook --project-ref rmoqgbrttdbgxntbxaxr --no-verify-jwt
```

## 3. Secrets (already set on the project)
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SITE_URL`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `RESEND_API_KEY`,
optional `BOOKINGS_FROM_EMAIL` (defaults to `bookings@email.therent.guru`).

## 4. Stripe webhook
Point the Stripe webhook endpoint at the OSR webhook:
```
https://rmoqgbrttdbgxntbxaxr.supabase.co/functions/v1/osr-stripe-webhook
```
Events: `checkout.session.completed`, `checkout.session.expired`.
(The signing secret is unchanged, so `STRIPE_WEBHOOK_SECRET` stays the same.)

## 5. Frontend
`common.js` → `BOOKING_FN` points at `osr-create-booking`, and `PAYMENTS_ENABLED = true`.
