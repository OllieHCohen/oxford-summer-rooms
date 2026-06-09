// ============================================================
// osr-address-lookup — Oxford Summer Rooms (namespaced, OSR-only)
//
// Proxies Postcoder UK address lookup, keeping POSTCODER_API_KEY server-side.
// The booking page calls this with ?q=<postcode> and gets back a simplified
// list of addresses to populate the billing-address fields.
//
// Deploy:  supabase functions deploy osr-address-lookup --project-ref rmoqgbrttdbgxntbxaxr --no-verify-jwt
// Secret:  POSTCODER_API_KEY
// ============================================================

const KEY = Deno.env.get("POSTCODER_API_KEY");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!KEY) return json({ error: "Address lookup not configured" }, 500);

  const q = (new URL(req.url).searchParams.get("q") || "").trim();
  if (q.length < 2) return json({ results: [] });

  const url = `https://ws.postcoder.com/pcw/${encodeURIComponent(KEY)}/address/UK/${encodeURIComponent(q)}?format=json&lines=2&identifier=oxfordsummerrooms`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    console.error("Postcoder fetch failed:", e);
    return json({ error: "Address lookup failed" }, 502);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // 404 from Postcoder = no addresses for that term
    if (res.status === 404) return json({ results: [] });
    console.error("Postcoder error:", res.status, detail);
    return json({ error: "Address lookup failed", status: res.status }, 502);
  }
  const data = await res.json().catch(() => []);
  const list = Array.isArray(data) ? data : [];
  const results = list.map((a: any) => {
    const line1 = a.addressline1 || a.premise || "";
    const line2 = a.addressline2 || "";
    const city = a.posttown || a.dependentlocality || "";
    const postcode = a.postcode || "";
    const summary = a.summaryline || [line1, line2, city, postcode].filter(Boolean).join(", ");
    return { line1, line2, city, postcode, summary };
  });
  return json({ results });
});
