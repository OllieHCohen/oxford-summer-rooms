# Booking backend — deploy guide

Three pieces turn the booking form into real, paid reservations:

1. **`bookings` table** — stores each booking (private; only the edge functions can read/write it).
2. **`create-booking`** edge function — validates, creates a £100 Stripe Checkout session, saves a pending booking, returns the Stripe URL.
3. **`stripe-webhook`** edge function — marks the booking `reserved` once Stripe confirms payment.

Project ref: `rmoqgbrttdbgxntbxaxr`.

## 1. Create the table
In the Supabase dashboard → SQL editor, run [`bookings.sql`](./bookings.sql).

## 2. Set secrets
```bash
supabase link --project-ref rmoqgbrttdbgxntbxaxr
supabase secrets set STRIPE_SECRET_KEY=sk_live_xxx           # or sk_test_xxx to test
supabase secrets set SITE_URL=https://www.oxfordsummerrooms.com
# (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically)
```

## 3. Deploy the functions
```bash
supabase functions deploy create-booking --no-verify-jwt
supabase functions deploy stripe-webhook --no-verify-jwt
```
`--no-verify-jwt` lets the public site call them with the anon key (create-booking does
its own validation; stripe-webhook verifies the Stripe signature instead).

## 4. Add the Stripe webhook
Stripe dashboard → Developers → Webhooks → Add endpoint:
- URL: `https://rmoqgbrttdbgxntbxaxr.supabase.co/functions/v1/stripe-webhook`
- Events: `checkout.session.completed`, `checkout.session.expired`
- Copy the signing secret and set it:
```bash
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx
```

## 5. Turn payments on in the frontend
In [`common.js`](../common.js) flip:
```js
const PAYMENTS_ENABLED = true;
```
Commit + deploy. The booking form will now create a Stripe session and redirect to pay.

## Test first
Use Stripe **test** keys and card `4242 4242 4242 4242` (any future expiry / CVC).
A successful test payment should create a `bookings` row that flips from
`pending_payment` to `reserved`, and land the guest on `book-success.html`.

## Notes
- The deposit is a normal £100 charge. To refund it (e.g. on move-in), refund the
  payment in the Stripe dashboard, or add a small `refund-deposit` function later.
- `create-booking` re-checks live status, room membership, availability windows, the
  14-night minimum, and date clashes **server-side**, so the £100 amount and the
  availability rules can't be tampered with from the browser.
- The anon key stays read-only for everything else; only these functions (service role)
  touch the `bookings` table.
