import { requireUser, json, fail, rateLimited, guard, supabaseAdmin } from "@/lib/server";

export const runtime = "nodejs";

const Pontos = require("@/public/pontos.js");

/**
 * Único caminho de gravação do placar do Grupo (team/placar/<id>; a RLS não deixa o navegador escrever ali).
 * Resumo calculado por versão anterior das regras é recusado: tela antiga aberta não sobrescreve o placar de ninguém.
 */
async function handler(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  if (rateLimited("team:" + auth.user.id, 120, 15 * 60_000)) return fail("rate_limited", "Muitas atualizações seguidas.", 429);
  const doc = await req.json().catch(() => null);
  if (doc?.rules !== Pontos.RULES.versao) return fail("outdated", "Versão antiga do app. Recarregue a página.", 409);
  if (typeof doc.days !== "object" || !doc.days || !Array.isArray(doc.acts)) return fail("invalid", "Resumo inválido.");
  const { error } = await supabaseAdmin().from("documents").upsert({ path: "team/placar/" + auth.user.id, owner: auth.user.id, data: doc }, { onConflict: "path" });
  if (error) { console.error("TEAM-01", error.message); return fail("upstream_error", "Não consegui salvar o placar agora.", 502); }
  return json({ ok: true });
}
export const POST = guard("O placar", "TEAM-01", handler);
