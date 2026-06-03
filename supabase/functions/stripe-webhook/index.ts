// ============================================================
// stripe-webhook — Oxford Summer Rooms
//
// Marks a booking "reserved" once Stripe confirms the £100 holding-deposit
// payment (checkout.session.completed). Also marks it "cancelled" if the
// session expires.
//
// Deploy:
//   supabase functions deploy stripe-webhook --no-verify-jwt
// Required secrets:
//   STRIPE_SECRET_KEY      = sk_live_... / sk_test_...
//   STRIPE_WEBHOOK_SECRET  = whsec_...  (from the Stripe webhook endpoint you create)
//
// In the Stripe dashboard, add a webhook endpoint pointing at:
//   https://rmoqgbrttdbgxntbxaxr.supabase.co/functions/v1/stripe-webhook
// subscribed to: checkout.session.completed, checkout.session.expired
// ============================================================

import Stripe from "https://esm.sh/stripe@16?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const cryptoProvider = Stripe.createSubtleCryptoProvider();

Deno.serve(async (req) => {
  const sig = req.headers.get("stripe-signature");
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig!, WEBHOOK_SECRET, undefined, cryptoProvider);
  } catch (e) {
    console.error("Signature verification failed:", (e as Error).message);
    return new Response(`Webhook error: ${(e as Error).message}`, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const s = event.data.object as Stripe.Checkout.Session;
    await supabase.from("bookings").update({
      status: "reserved",
      stripe_payment_intent: typeof s.payment_intent === "string" ? s.payment_intent : null,
      stripe_status: "paid",
    }).eq("stripe_session_id", s.id);
  } else if (event.type === "checkout.session.expired") {
    const s = event.data.object as Stripe.Checkout.Session;
    await supabase.from("bookings").update({ status: "cancelled", stripe_status: "expired" })
      .eq("stripe_session_id", s.id).eq("status", "pending_payment");
  }

  return new Response("ok", { status: 200 });
});
