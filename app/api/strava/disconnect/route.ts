import { requireUser, supabaseAdmin, json } from "@/lib/server";
import { stravaToken } from "@/lib/strava";

export const runtime = "nodejs";

/** Desconecta o Strava do usuário (revoga no Strava e apaga os tokens). */
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const token = await stravaToken(auth.user.id);
  if (token) await fetch("https://www.strava.com/oauth/deauthorize", { method: "POST", headers: { authorization: `Bearer ${token}` } }).catch(() => null);
  await supabaseAdmin().from("strava_tokens").delete().eq("user_id", auth.user.id);
  return json({ ok: true });
}
