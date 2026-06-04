// ============================================================
// osr-static-map — Oxford Summer Rooms (namespaced, OSR-only)
//
// Google Static Maps proxy that supports multiple markers / center / zoom,
// keeping the Google key server-side. Used for the homepage map (both property
// pins + Oxford city centre). Forwards a safe allow-list of Static Maps params.
//
// Deploy:  supabase functions deploy osr-static-map --project-ref rmoqgbrttdbgxntbxaxr --no-verify-jwt
// Secret:  GOOGLE_MAPS_API_KEY
// ============================================================

const KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// Only these Static Maps params are forwarded.
const ALLOWED = ["center", "zoom", "size", "scale", "maptype", "markers", "path", "language", "region", "format", "style"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!KEY) return new Response(JSON.stringify({ error: "Maps key not configured" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });

  const inUrl = new URL(req.url);
  const p = new URLSearchParams();
  for (const k of ALLOWED) for (const v of inUrl.searchParams.getAll(k)) p.append(k, v);
  if (!p.has("size")) p.set("size", "600x600");
  p.append("key", KEY);

  const gUrl = `https://maps.googleapis.com/maps/api/staticmap?${p.toString()}`;
  let res: Response;
  try {
    res = await fetch(gUrl);
  } catch (e) {
    return new Response(JSON.stringify({ error: "Map fetch failed", detail: String(e) }), { status: 502, headers: { ...cors, "Content-Type": "application/json" } });
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return new Response(JSON.stringify({ error: `static maps ${res.status}`, detail }), { status: 502, headers: { ...cors, "Content-Type": "application/json" } });
  }
  return new Response(res.body, {
    status: 200,
    headers: { ...cors, "Content-Type": res.headers.get("content-type") ?? "image/png", "Cache-Control": "public, max-age=3600" },
  });
});
