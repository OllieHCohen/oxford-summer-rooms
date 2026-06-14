// ============================================================
// osr-book-viewing — Oxford Summer Rooms (namespaced, OSR-only)
//
// Records a viewing request in osr_viewings, computes the next 4pm viewing slot
// (Mon-Fri, UK time; today if before 3pm on a weekday, else next weekday), and
// sends a Telegram + email alert to mail@therent.guru.
//
// Deploy:  supabase functions deploy osr-book-viewing --project-ref rmoqgbrttdbgxntbxaxr --no-verify-jwt
// Secrets used: SUPABASE_URL/SERVICE_ROLE_KEY (auto); TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
//   RESEND_API_KEY, BOOKINGS_FROM_EMAIL (optional).
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Next viewing: 4pm, Mon-Fri, UK time. Today if weekday & before 3pm, else next weekday.
function nextViewing() {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value])) as Record<string, string>;
  const y = +p.year, m = +p.month, d = +p.day, hour = +p.hour;
  let dt = new Date(Date.UTC(y, m - 1, d));
  const weekday = (x: Date) => { const w = x.getUTCDay(); return w >= 1 && w <= 5; };
  if (!(weekday(dt) && hour < 15)) { do { dt.setUTCDate(dt.getUTCDate() + 1); } while (!weekday(dt)); }
  const date = dt.toISOString().slice(0, 10);
  const label = `${DAYS[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()} at 4:00pm`;
  return { date, label };
}

async function notify(row: any) {
  const name = `${row.first_name} ${row.last_name}`.trim();
  const tgToken = Deno.env.get("TELEGRAM_BOT_TOKEN"), tgChat = Deno.env.get("TELEGRAM_CHAT_ID");
  if (tgToken && tgChat) {
    const text =
`📅 NEW VIEWING REQUEST — Oxford Summer Rooms

Property: ${row.property_address ?? "—"}
Viewing: ${row.viewing_label}

${name}
${row.email}
${row.mobile}
${row.notes ? `Notes: ${row.notes}` : "Notes: —"}`;
    try { await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: tgChat, text, disable_web_page_preview: true }) }); }
    catch (e) { console.error("Telegram failed:", e); }
  }
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (resendKey) {
    const from = Deno.env.get("BOOKINGS_FROM_EMAIL") ?? "Oxford Summer Rooms <bookings@email.therent.guru>";
    const row2 = (l: string, v: string) => `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;white-space:nowrap;vertical-align:top">${l}</td><td style="padding:6px 0;color:#1d2330;font-weight:600">${v || "—"}</td></tr>`;
    const html =
`<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1d2330">
  <h2 style="color:#15803d;margin:0 0 12px">New viewing request — Oxford Summer Rooms</h2>
  <table style="border-collapse:collapse;font-size:14px;width:100%">
    ${row2("Property", row.property_address ?? "—")}
    ${row2("Viewing", row.viewing_label)}
    ${row2("Name", name)}
    ${row2("Email", row.email)}
    ${row2("Mobile", row.mobile)}
    ${row2("Notes", row.notes ?? "—")}
  </table>
</div>`;
    try {
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: ["mail@therent.guru"], cc: ["ohc@ohcgroup.com"], subject: `Viewing request — ${name} (${row.viewing_label})`, html }) });
      if (!r.ok) console.error("Resend error:", r.status, await r.text());
    } catch (e) { console.error("Email failed:", e); }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const first = (body.first_name || "").trim(), last = (body.last_name || "").trim();
  const email = (body.email || "").trim(), mobile = (body.mobile || "").trim();
  if (!first || !last || !email || !mobile) return json({ error: "Please fill in your name, email and mobile." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Please enter a valid email." }, 400);

  const slot = nextViewing();
  const record = {
    source: body.source === "property" ? "property" : "homepage",
    property_id: body.property_id ?? null,
    property_address: body.property_address ?? null,
    viewing_date: slot.date,
    viewing_time: "16:00",
    viewing_label: slot.label,
    first_name: first, last_name: last, email, mobile,
    notes: (body.notes || "").trim() || null,
  };

  const { error } = await supabase.from("osr_viewings").insert(record);
  if (error) { console.error("Insert error:", error); return json({ error: "Could not save your request. Please try again." }, 500); }

  try { await notify(record); } catch (e) { console.error("notify failed:", e); }

  return json({ ok: true, viewing_label: slot.label, viewing_date: slot.date });
});
