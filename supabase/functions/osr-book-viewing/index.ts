// ============================================================
// osr-book-viewing — Oxford Summer Rooms (namespaced, OSR-only)
//
// Records a viewing request in osr_viewings, computes the next 4pm viewing slot
// (Mon-Fri, UK time; today if before 3pm on a weekday, else next weekday), sends a
// Telegram + email alert to mail@therent.guru, and emails a confirmation to the
// guest (cc + reply-to mail@therent.guru) from the verified email.therent.guru domain.
//
// Accepts either a single property (legacy modal: property_id/property_address) or a
// multi-select list (book-viewing.html: properties: [{id, address}]). When several are
// chosen the first is the meeting point ("meet at the first property at 4pm").
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

async function notify(row: any, view: { addresses: string[]; multi: boolean; meetAddress: string | null }) {
  const name = `${row.first_name} ${row.last_name}`.trim();
  const tgPropsBlock = view.multi
    ? `Properties to view:\n${view.addresses.map((a) => `• ${a}`).join("\n")}\nMeet at the first property: ${view.meetAddress} at 4:00pm`
    : `Property: ${view.meetAddress ?? "—"}`;
  const tgToken = Deno.env.get("TELEGRAM_BOT_TOKEN"), tgChat = Deno.env.get("TELEGRAM_CHAT_ID");
  if (tgToken && tgChat) {
    const text =
`📅 NEW VIEWING REQUEST — Oxford Summer Rooms

${tgPropsBlock}
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
    ${view.multi
      ? row2("Properties", view.addresses.join("<br>")) + row2("Meet at", `${view.meetAddress} at 4:00pm (first property)`)
      : row2("Property", view.meetAddress ?? "—")}
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

    // Confirmation email to the guest (cc + reply-to mail@therent.guru).
    const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const propPad = view.multi ? 6 : 14;
    const propRow = view.addresses.length
      ? `<tr><td style="padding:0 16px ${propPad}px;color:#6b7280;font-size:14px;vertical-align:top">${view.multi ? "Properties" : "Property"}</td><td style="padding:0 16px ${propPad}px 0;font-size:15px;font-weight:700">${view.addresses.map((a) => esc(a)).join("<br>")}</td></tr>`
      : "";
    const meetRow = view.multi && view.meetAddress
      ? `<tr><td style="padding:0 16px 14px;color:#6b7280;font-size:14px;vertical-align:top">Meeting point</td><td style="padding:0 16px 14px 0;font-size:15px;font-weight:700">${esc(view.meetAddress)}</td></tr>`
      : "";
    const meetLine = view.multi && view.meetAddress
      ? `<p style="margin:0 0 16px">You've asked to view ${view.addresses.length} properties — please meet us at the first one, <strong>${esc(view.meetAddress)}</strong>, at 4:00pm and we'll take you round the others from there.</p>`
      : "";
    const guestHtml =
`<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:auto;color:#1d2330;font-size:15px;line-height:1.6">
  <div style="border-top:4px solid #15803d;padding:24px 28px;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px">
    <div style="font-size:20px;font-weight:700;color:#15803d;margin:0 0 4px">Oxford Summer Rooms</div>
    <div style="font-size:13px;color:#6b7280;margin:0 0 22px">Short-term summer rooms in Oxford</div>
    <div style="font-size:22px;font-weight:700;margin:0 0 16px;color:#1d2330">Your viewing is confirmed</div>
    <p style="margin:0 0 16px">Hi ${esc(row.first_name)},</p>
    <p style="margin:0 0 18px">Thanks for booking a viewing with Oxford Summer Rooms. Here are your details:</p>
    <table style="width:100%;border-collapse:collapse;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;margin:0 0 20px">
      <tr>
        <td style="padding:14px 16px 6px;color:#6b7280;font-size:14px;width:110px;vertical-align:top">Date &amp; time</td>
        <td style="padding:14px 16px 6px 0;font-size:15px;font-weight:700">${esc(row.viewing_label)}</td>
      </tr>
      ${propRow}
      ${meetRow}
    </table>
    ${meetLine}
    <p style="margin:0 0 16px">We'll be in touch shortly to confirm. If you'd prefer a virtual viewing over WhatsApp, just reply and let us know — we'll call you instead.</p>
    <p style="margin:0 0 22px">Need to change your viewing or have a question? Just reply to this email, or message us on WhatsApp at <a href="https://wa.me/447378210071" style="color:#15803d;font-weight:600;text-decoration:none">07378&nbsp;210071</a>.</p>
    <p style="margin:0 0 4px">See you soon,</p>
    <p style="margin:0 0 24px;font-weight:600">The Oxford Summer Rooms team</p>
    <div style="border-top:1px solid #e5e7eb;padding-top:16px;font-size:12px;color:#6b7280;line-height:1.6">
      Oxford Summer Rooms — operated by Bannits Ltd t/a The Rent Guru<br>
      WhatsApp / phone: 07378 210071 &nbsp;·&nbsp; <a href="https://www.oxfordsummerrooms.com" style="color:#6b7280">www.oxfordsummerrooms.com</a>
    </div>
  </div>
</div>`;
    try {
      const rg = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [row.email], cc: ["mail@therent.guru"], reply_to: "mail@therent.guru", subject: `Your Oxford Summer Rooms viewing — ${row.viewing_label}`, html: guestHtml }) });
      if (!rg.ok) console.error("Guest email error:", rg.status, await rg.text());
    } catch (e) { console.error("Guest email failed:", e); }
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

  // Selected properties. The multi-select page sends `properties: [{id, address}]`;
  // the legacy modal sends a single property_id/property_address. First = meeting point.
  const rawProps = Array.isArray(body.properties) ? body.properties : [];
  let selected = rawProps
    .map((p: any) => ({
      id: p && p.id != null && !isNaN(parseInt(p.id, 10)) ? parseInt(p.id, 10) : null,
      address: p && typeof p.address === "string" ? p.address.trim() : "",
    }))
    .filter((p: any) => p.address || p.id != null);
  if (!selected.length) {
    const addr = (body.property_address || "").trim();
    if (addr || body.property_id != null) {
      selected = [{ id: body.property_id != null ? parseInt(body.property_id, 10) : null, address: addr }];
    }
  }
  const addresses = selected.map((s) => s.address).filter(Boolean);
  const view = { addresses, multi: selected.length > 1, meetAddress: addresses[0] ?? null };

  const slot = nextViewing();
  const record = {
    source: ["property", "viewings-page", "homepage"].includes(body.source) ? body.source : "homepage",
    property_id: selected[0]?.id ?? null,
    property_address: addresses.length ? addresses.join(" • ") : null,
    viewing_date: slot.date,
    viewing_time: "16:00",
    viewing_label: slot.label,
    first_name: first, last_name: last, email, mobile,
    notes: (body.notes || "").trim() || null,
  };

  const { error } = await supabase.from("osr_viewings").insert(record);
  if (error) { console.error("Insert error:", error); return json({ error: "Could not save your request. Please try again." }, 500); }

  try { await notify(record, view); } catch (e) { console.error("notify failed:", e); }

  return json({ ok: true, viewing_label: slot.label, viewing_date: slot.date });
});
