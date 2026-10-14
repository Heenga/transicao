import { requireUser, supabaseAdmin, json } from "@/lib/server";
import { loadIntervals } from "@/lib/intervals";

export const runtime = "nodejs";

/** Quem sou eu: usuário, se é organizador e se o Strava está conectado. */
export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const sb = supabaseAdmin();
  const [{ data: m }, { data: t }, iv] = await Promise.all([
    sb.from("members").select("username,is_admin").eq("user_id", auth.user.id).maybeSingle(),
    sb.from("strava_tokens").select("athlete_id,updated_at").eq("user_id", auth.user.id).maybeSingle(),
    loadIntervals(auth.user.id).catch(() => null),
  ]);
  return json({
    id: auth.user.id, username: m?.username, isAdmin: !!m?.is_admin,
    strava: t ? { connected: true, athleteId: t.athlete_id, since: t.updated_at } : { connected: false },
    ai: !!process.env.ANTHROPIC_API_KEY,
    intervals: iv ? { connected: true, athleteName: iv.athleteName } : { connected: false },
  });
}
