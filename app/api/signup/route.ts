import { supabaseAdmin, usernameToEmail, json, fail, env, rateLimited } from "@/lib/server";

export const runtime = "nodejs";

// Código do grupo desativado por enquanto (só existe um grupo). Para reativar: true + mostrar o campo #auth_code.
const REQUIRE_GROUP_CODE = false;

/** Cria a conta (usuário + senha); o limite de membros continua valendo. */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "local";
  if (rateLimited("signup:" + ip, 8, 10 * 60_000)) return fail("rate_limited", "Muitas tentativas. Espere alguns minutos.", 429);

  let body: any;
  try { body = await req.json(); } catch { return fail("bad_request", "Requisição inválida."); }
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  const code = String(body.code || "").trim();

  if (!/^[a-z0-9._]{3,20}$/.test(username)) return fail("bad_username", "Usuário deve ter 3 a 20 caracteres: letras minúsculas, números, ponto ou _.");
  if (password.length < 6) return fail("weak_password", "A senha precisa ter pelo menos 4 caracteres.");
  if (REQUIRE_GROUP_CODE && code !== env("GROUP_INVITE_CODE")) return fail("bad_code", "Código do grupo incorreto. Peça ao organizador.", 403);

  const sb = supabaseAdmin();
  const { count } = await sb.from("members").select("user_id", { count: "exact", head: true });
  const max = Number(process.env.MAX_MEMBERS || 4);
  if ((count ?? 0) >= max) return fail("group_full", `O grupo já tem ${max} participantes.`, 403);

  const { data: taken } = await sb.from("members").select("user_id").eq("username", username).maybeSingle();
  if (taken) return fail("username_taken", "Esse usuário já existe. Escolha outro ou faça login.", 409);

  const { data, error } = await sb.auth.admin.createUser({
    email: usernameToEmail(username), password, email_confirm: true, user_metadata: { username },
  });
  if (error || !data.user) return fail("create_failed", error?.message?.includes("already") ? "Esse usuário já existe." : "Não consegui criar a conta. Tente de novo.", 400);

  const admins = String(process.env.ADMIN_USERNAMES || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  const isAdmin = admins.includes(username) || (count ?? 0) === 0;
  const { error: mErr } = await sb.from("members").insert({ user_id: data.user.id, username, is_admin: isAdmin });
  if (mErr) { await sb.auth.admin.deleteUser(data.user.id); return fail("create_failed", "Não consegui registrar a conta no grupo.", 500); }

  // prova padrão do grupo, criada na primeira conta
  await sb.from("documents").upsert({
    path: "config/race", owner: data.user.id,
    data: { name: "All Limits", label: "High Limits", type: "olimpico", date: "2027-05-30", time: "06:30", place: "Lagoa dos Ingleses · Alphaville, Nova Lima – MG" },
  }, { onConflict: "path", ignoreDuplicates: true });

  return json({ ok: true, username });
}
