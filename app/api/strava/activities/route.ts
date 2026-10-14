import { requireUser, json, fail, rateLimited, guard } from "@/lib/server";
import { stravaToken, stravaGet } from "@/lib/strava";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Treinos do Strava do usuário logado.
 * ?days=60&page=1&per_page=100 — o app pede primeiro os recentes (rápido) e depois o histórico.
 * ?zones=1 devolve as zonas de FC/potência.
 */
async function handler(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  if (rateLimited("strava:" + auth.user.id, 30, 15 * 60_000)) return fail("rate_limited", "Muitas sincronizações seguidas. Espere alguns minutos.", 429);
  const token = await stravaToken(auth.user.id);
  if (!token) return fail("server_not_connected", "Conecte seu Strava primeiro.", 409);

  const u = new URL(req.url);
  if (u.searchParams.get("zones")) {
    const z = await stravaGet(token, "/athlete/zones");
    return json({ zones: z.data });
  }
  const days = Math.min(Number(u.searchParams.get("days")) || 60, 400);
  const before = Number(u.searchParams.get("before_days")) || 0;
  const params: Record<string, number> = {
    after: Math.floor((Date.now() - days * 864e5) / 1000),
    per_page: Math.min(Number(u.searchParams.get("per_page")) || 100, 200),
    page: Math.max(1, Number(u.searchParams.get("page")) || 1),
  };
  if (before) params.before = Math.floor((Date.now() - before * 864e5) / 1000);
  const r = await stravaGet(token, "/athlete/activities", params);
  if (r.status === 401) return fail("needs_reauth", "A conexão com o Strava expirou. Conecte de novo.", 409);
  if (r.status === 429) return fail("rate_limited", "Limite do Strava atingido. Tente em 15 minutos.", 429);
  if (!r.data) return fail("upstream_error", "O Strava não respondeu.", 502);
  const acts = (r.data as any[]).map(a => ({
    id: String(a.id), name: a.name, sport_type: a.sport_type || a.type, start_date_local: a.start_date_local,
    distance: a.distance, moving_time: a.moving_time, elapsed_time: a.elapsed_time,
    average_heartrate: a.average_heartrate ?? null, max_heartrate: a.max_heartrate ?? null,
    total_elevation_gain: a.total_elevation_gain, average_watts: a.average_watts ?? null,
    average_cadence: a.average_cadence ?? null, suffer_score: a.suffer_score ?? null, trainer: !!a.trainer,
  }));
  return json({ activities: acts, has_more: acts.length === params.per_page });
}
export const GET = guard("A leitura do Strava", "STRAVA-02", handler);
