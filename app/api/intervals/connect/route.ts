import { requireUser, json, fail, guard } from "@/lib/server";
import { intervalsFetch, saveIntervals } from "@/lib/intervals";

export const runtime = "nodejs";

/** Confere a chave do intervals.icu e guarda criptografada. */
async function handler(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  let body: any; try { body = await req.json(); } catch { return fail("bad_request", "Algo deu errado. Tente de novo."); }
  const apiKey = String(body.apiKey || "").trim();
  if (apiKey.length < 10) return fail("bad_key", "Cole a chave (API Key) do intervals.icu: fica em Settings, no fim da página, em Developer Settings.");
  const r = await intervalsFetch(apiKey, "/athlete/0");
  if (r.status === 401 || r.status === 403) return fail("bad_key", "O intervals.icu recusou essa chave. Confira se copiou a chave inteira.", 400);
  if (!r.ok || !r.data?.id) return fail("upstream_error", "Não consegui falar com o intervals.icu. Tente de novo.", 502);
  await saveIntervals(auth.user.id, apiKey, { id: String(r.data.id), name: String(r.data.name || "") });
  return json({ ok: true, athleteId: r.data.id, athleteName: r.data.name || "" });
}
export const POST = guard("A conexão com o Garmin", "GARMIN-01", handler);
