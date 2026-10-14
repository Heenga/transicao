import { supabaseAdmin, env } from "./server";

/** Devolve um access token válido do Strava para o usuário, renovando se estiver vencendo. */
export async function stravaToken(userId: string): Promise<string | null> {
  const sb = supabaseAdmin();
  const { data: t } = await sb.from("strava_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (!t) return null;
  if (t.expires_at - 120 > Math.floor(Date.now() / 1000)) return t.access_token;
  const r = await fetch("https://www.strava.com/oauth/token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: env("STRAVA_CLIENT_ID"), client_secret: env("STRAVA_CLIENT_SECRET"), grant_type: "refresh_token", refresh_token: t.refresh_token }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  await sb.from("strava_tokens").update({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at, updated_at: new Date().toISOString() }).eq("user_id", userId);
  return j.access_token;
}

export async function stravaGet(token: string, path: string, params: Record<string, string | number> = {}) {
  const url = new URL("https://www.strava.com/api/v3" + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: ctl.signal });
    return { status: r.status, data: r.ok ? await r.json() : null };
  } finally { clearTimeout(to); }
}
