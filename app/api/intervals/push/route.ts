import { requireUser, json, fail, rateLimited } from "@/lib/server";
import { intervalsFetch, loadIntervals } from "@/lib/intervals";

export const runtime = "nodejs";

/**
 * Envia (cria ou atualiza) os treinos planejados no calendário do intervals.icu, que repassa ao Garmin.
 * Corpo: { events: [...], remove: ["external_id", ...] }. Cada evento usa external_id para não duplicar.
 */
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  if (rateLimited("intervals:" + auth.user.id, 30, 10 * 60_000)) return fail("rate_limited", "Muitos envios seguidos. Espere alguns minutos.", 429);
  const cfg = await loadIntervals(auth.user.id);
  if (!cfg) return fail("not_connected", "Conecte o intervals.icu em Configurações.", 400);
  let body: any; try { body = await req.json(); } catch { return fail("bad_request", "Algo deu errado. Tente de novo."); }
  const events = (Array.isArray(body.events) ? body.events : []).slice(0, 60).map((e: any) => ({
    category: "WORKOUT", external_id: String(e.external_id).slice(0, 120), start_date_local: String(e.start_date_local),
    type: String(e.type || "Run"), name: String(e.name || "Treino").slice(0, 120), description: String(e.description || "").slice(0, 8000),
    ...(e.moving_time ? { moving_time: Math.round(Number(e.moving_time)) } : {}),
  }));
  const remove = (Array.isArray(body.remove) ? body.remove : []).slice(0, 100).map((x: any) => ({ external_id: String(x) }));
  if (remove.length) await intervalsFetch(cfg.apiKey, "/athlete/0/events/bulk-delete", { method: "PUT", body: JSON.stringify(remove) });
  if (!events.length) return json({ ok: true, sent: 0, removed: remove.length });
  const r = await intervalsFetch(cfg.apiKey, "/athlete/0/events/bulk?upsert=true", { method: "POST", body: JSON.stringify(events) });
  if (r.status === 401 || r.status === 403) return fail("bad_key", "A chave do intervals.icu não vale mais. Conecte de novo em Configurações.", 400);
  if (!r.ok) return fail("upstream_error", "O intervals.icu não aceitou os treinos agora. Tente de novo.", 502);
  // quantos passos o intervals.icu reconheceu em cada treino (0 = virou só texto)
  const steps = Array.isArray(r.data) ? r.data.map((x: any) => ({ external_id: x.external_id, steps: x.workout_doc?.steps?.length ?? 0 })) : [];
  return json({ ok: true, sent: events.length, removed: remove.length, steps });
}
