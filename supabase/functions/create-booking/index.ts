// ============================================================
// create-booking — Oxford Summer Rooms
//
// Creates a £100 refundable holding-deposit Stripe Checkout Session and
// records a pending booking. The browser redirects the guest to the returned
// `url` to pay; the stripe-webhook function then marks the booking "reserved".
//
// Deploy:
//   supabase functions deploy create-booking --no-verify-jwt
// Required secrets (supabase secrets set ...):
//   STRIPE_SECRET_KEY   = sk_live_... (or sk_test_...)
//   SITE_URL            = https://www.oxfordsummerrooms.com   (optional, for redirects)
//   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
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

const HOLDING_DEPOSIT_PENCE = 10000; // £100
const MIN_NIGHTS = 14;
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://www.oxfordsummerrooms.com";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const nights = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { property_id, room_id, check_in, check_out, guest } = body ?? {};
  if (!property_id || !room_id || !check_in || !check_out || !guest) {
    return json({ error: "Missing required fields" }, 400);
  }
  const g = guest, a = guest.address ?? {};
  const required: Record<string, unknown> = {
    first_name: g.first_name, last_name: g.last_name, email: g.email, mobile: g.mobile,
    line1: a.line1, city: a.city, postcode: a.postcode, country: a.country,
  };
  for (const [k, v] of Object.entries(required)) {
    if (!v || !String(v).trim()) return json({ error: `Missing ${k}` }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(g.email))) return json({ error: "Invalid email" }, 400);

  const n = nights(check_in, check_out);
  if (!(n >= MIN_NIGHTS)) return json({ error: `Minimum stay is ${MIN_NIGHTS} nights.` }, 400);

  // --- server-side re-validation against live data (never trust the client) ---
  const [liveRes, memberRes, windowsRes, roomRes] = await Promise.all([
    supabase.from("property_live_status").select("property_id").eq("property_id", room_id).eq("is_live", true).maybeSingle(),
    supabase.from("summer_void_members").select("property_id, room_location").eq("void_property_id", property_id).eq("property_id", room_id).maybeSingle(),
    supabase.from("room_availability").select("window_start, window_end").eq("property_id", room_id),
    supabase.from("bannits_property_cache").select("rent_per_month, property_name").eq("property_id", room_id).maybeSingle(),
  ]);

  if (!liveRes.data) return json({ error: "This room is not available to book." }, 409);
  if (!memberRes.data) return json({ error: "Room does not belong to this property." }, 400);

  const windows = windowsRes.data ?? [];
  const insideWindow = windows.some((w: any) =>
    check_in >= w.window_start && check_out <= w.window_end && nights(w.window_start, w.window_end) >= MIN_NIGHTS);
  if (!insideWindow) return json({ error: "Selected dates are not available." }, 409);

  // --- prevent double-booking the same room over overlapping dates ---
  const { data: clash } = await supabase.from("bookings").select("id")
    .eq("room_id", room_id).in("status", ["pending_payment", "reserved"])
    .lt("check_in", check_out).gt("check_out", check_in).limit(1);
  if (clash && clash.length) return json({ error: "Those dates have just been taken. Please choose other dates." }, 409);

  const weekly = roomRes.data?.rent_per_month ? Math.round(Number(roomRes.data.rent_per_month) * 12 / 52) : null;
  const roomLabel = memberRes.data.room_location ?? roomRes.data?.property_name ?? "Room";

  // --- create Stripe Checkout Session (£100 refundable holding deposit) ---
  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: g.email,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "gbp",
          unit_amount: HOLDING_DEPOSIT_PENCE,
          product_data: {
            name: "Refundable holding deposit",
            description: `${roomLabel} · ${check_in} → ${check_out}`,
          },
        },
      }],
      payment_intent_data: { description: `Holding deposit — room ${room_id} (${check_in}..${check_out})` },
      metadata: { property_id: String(property_id), room_id: String(room_id), check_in, check_out },
      success_url: `${SITE_URL}/book-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/book.html?property=${property_id}&room=${room_id}`,
    });
  } catch (e) {
    console.error("Stripe error:", e);
    return json({ error: "Could not start payment. Please try again." }, 502);
  }

  // --- record the pending booking (service role bypasses RLS) ---
  const { error: insErr } = await supabase.from("bookings").insert({
    status: "pending_payment",
    property_id, room_id,
    room_location: memberRes.data.room_location ?? null,
    property_address: body.property_address ?? null,
    check_in, check_out, nights: n,
    weekly_rent: weekly, cleaning_fee: 100,
    estimated_stay_total: weekly ? Math.round(weekly * n / 7 + 100) : null,
    holding_deposit: 100,
    guest_first_name: g.first_name, guest_last_name: g.last_name,
    guest_email: g.email, guest_mobile: g.mobile,
    addr_line1: a.line1, addr_line2: a.line2 ?? null, addr_city: a.city,
    addr_postcode: a.postcode, addr_country: a.country,
    stripe_session_id: session.id,
  });
  if (insErr) { console.error("Insert error:", insErr); return json({ error: "Could not save booking." }, 500); }

  return json({ url: session.url });
});
