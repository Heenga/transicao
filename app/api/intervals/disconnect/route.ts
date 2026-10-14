import { requireUser, json } from "@/lib/server";
import { deleteIntervals } from "@/lib/intervals";

export const runtime = "nodejs";

/** Esquece a chave do intervals.icu (os treinos já enviados continuam lá). */
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  await deleteIntervals(auth.user.id);
  return json({ ok: true });
}
