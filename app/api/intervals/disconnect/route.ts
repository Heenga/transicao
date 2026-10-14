import { requireUser, json, guard } from "@/lib/server";
import { deleteIntervals } from "@/lib/intervals";

export const runtime = "nodejs";

/** Esquece a chave do intervals.icu (os treinos já enviados continuam lá). */
async function handler(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  await deleteIntervals(auth.user.id);
  return json({ ok: true });
}
export const POST = guard("A conexão com o Garmin", "GARMIN-03", handler);
