// ============================================================
// osr-stripe-webhook — Oxford Summer Rooms (namespaced, OSR-only)
//
// On checkout.session.completed (for OSR sessions): marks the osr_bookings row
// "reserved", then sends a Telegram alert and an email (to mail@therent.guru,
// cc ohc@ohcgroup.com) with full booking details. On expired: marks cancelled.
// Only touches the OSR-only `osr_bookings` table.
//
// Deploy:
//   supabase functions deploy osr-stripe-webhook --no-verify-jwt
// Point your Stripe webhook endpoint at:
//   https://rmoqgbrttdbgxntbxaxr.supabase.co/functions/v1/osr-stripe-webhook
// Secrets used: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (required);
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, RESEND_API_KEY, BOOKINGS_FROM_EMAIL (optional).
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtD = (iso: string) => { const [y, m, d] = String(iso).split("-"); return `${+d} ${MONTHS[+m - 1]} ${y}`; };
const money = (n: unknown) => (n == null ? "—" : "£" + Number(n).toLocaleString("en-GB"));

async function notify(b: any, session: Stripe.Checkout.Session) {
  const amountPaid = session.amount_total != null ? `£${(session.amount_total / 100).toFixed(2)}` : money(b.holding_deposit);
  const fullName = `${b.guest_first_name ?? ""} ${b.guest_last_name ?? ""}`.trim();
  const addr = [b.addr_line1, b.addr_line2, b.addr_city, b.addr_postcode, b.addr_country].filter(Boolean).join(", ");

  const tgToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const tgChat = Deno.env.get("TELEGRAM_CHAT_ID");
  if (tgToken && tgChat) {
    const text =
`🏠 NEW BOOKING — Oxford Summer Rooms

Property #${b.property_id} — ${b.property_address ?? ""}
Room #${b.room_id} — ${b.room_location ?? ""}
Dates: ${fmtD(b.check_in)} → ${fmtD(b.check_out)} (${b.nights} nights)
Weekly rent: ${money(b.weekly_rent)} · Est. stay total: ${money(b.estimated_stay_total)}
✅ Holding deposit PAID: ${amountPaid}

Guest:
• ${fullName}
• ${b.guest_email}
• ${b.guest_mobile}
• ${addr}

Stripe payment: ${b.stripe_payment_intent ?? session.payment_intent ?? "—"}`;
    try {
      await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: tgChat, text, disable_web_page_preview: true }),
      });
    } catch (e) { console.error("Telegram failed:", e); }
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (resendKey) {
    const from = Deno.env.get("BOOKINGS_FROM_EMAIL") ?? "Oxford Summer Rooms <bookings@email.therent.guru>";
    const row = (l: string, v: string) =>
      `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;white-space:nowrap;vertical-align:top">${l}</td><td style="padding:6px 0;color:#1d2330;font-weight:600">${v || "—"}</td></tr>`;
    const html =
`<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#1d2330">
  <h2 style="color:#1f3a66;margin:0 0 4px">New booking — Oxford Summer Rooms</h2>
  <p style="color:#15803d;font-weight:700;margin:0 0 16px">✅ £100 refundable holding deposit paid — room reserved</p>
  <table style="border-collapse:collapse;font-size:14px;width:100%">
    ${row("Property", `#${b.property_id} — ${b.property_address ?? ""}`)}
    ${row("Room", `#${b.room_id} — ${b.room_location ?? ""}`)}
    ${row("Check-in", fmtD(b.check_in))}
    ${row("Check-out", fmtD(b.check_out))}
    ${row("Nights", String(b.nights))}
    ${row("Weekly rent", money(b.weekly_rent))}
    ${row("Est. stay total", money(b.estimated_stay_total))}
    ${row("Deposit paid", amountPaid)}
    <tr><td colspan="2" style="padding:12px 0 4px"><strong style="color:#1f3a66">Guest</strong></td></tr>
    ${row("Name", fullName)}
    ${row("Email", b.guest_email)}
    ${row("Mobile", b.guest_mobile)}
    ${row("Billing address", addr)}
    <tr><td colspan="2" style="padding:12px 0 4px"><strong style="color:#1f3a66">Payment</strong></td></tr>
    ${row("Stripe payment", b.stripe_payment_intent ?? String(session.payment_intent ?? "—"))}
    ${row("Booking ref", b.id)}
  </table>
</div>`;
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: ["mail@therent.guru"],
          cc: ["ohc@ohcgroup.com"],
          subject: `New booking — ${b.room_location ?? "Room"} (${fmtD(b.check_in)}–${fmtD(b.check_out)})`,
          html,
        }),
      });
      if (!r.ok) console.error("Resend error:", r.status, await r.text());
    } catch (e) { console.error("Email failed:", e); }
  }
}

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
    const { data: booking, error } = await supabase.from("osr_bookings").update({
      status: "reserved",
      stripe_payment_intent: typeof s.payment_intent === "string" ? s.payment_intent : null,
      stripe_status: "paid",
    }).eq("stripe_session_id", s.id).select().maybeSingle();
    if (error) console.error("Update failed:", error);
    // Only notify for OSR bookings (rows that exist in osr_bookings).
    if (booking) { try { await notify(booking, s); } catch (e) { console.error("notify failed:", e); } }
  } else if (event.type === "checkout.session.expired") {
    const s = event.data.object as Stripe.Checkout.Session;
    await supabase.from("osr_bookings").update({ status: "cancelled", stripe_status: "expired" })
      .eq("stripe_session_id", s.id).eq("status", "pending_payment");
  }

  return new Response("ok", { status: 200 });
});
