import { supabaseAdmin, env, verifyState } from "@/lib/server";

export const runtime = "nodejs";

/** Retorno do Strava depois que a pessoa autoriza. Guarda os tokens dela no banco (só o servidor lê). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const back = (q: string) => Response.redirect(`${env("APP_URL")}/?strava=${q}`, 302);
  if (u.searchParams.get("error")) return back("negado");
  const userId = verifyState(u.searchParams.get("state") || "");
  const code = u.searchParams.get("code");
  if (!userId || !code) return back("erro");

  const r = await fetch("https://www.strava.com/oauth/token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: env("STRAVA_CLIENT_ID"), client_secret: env("STRAVA_CLIENT_SECRET"), code, grant_type: "authorization_code" }),
  });
  if (!r.ok) return back(r.status === 403 ? "limite" : "erro");
  const j = await r.json();
  const scope = u.searchParams.get("scope") || "";
  if (!/activity:read/.test(scope)) return back("sem-permissao");

  const { error } = await supabaseAdmin().from("strava_tokens").upsert({
    user_id: userId, athlete_id: j.athlete?.id ?? null, access_token: j.access_token, refresh_token: j.refresh_token,
    expires_at: j.expires_at, scope, updated_at: new Date().toISOString(),
  });
  return back(error ? "erro" : "ok");
}
