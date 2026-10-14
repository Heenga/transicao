import { createClient, SupabaseClient, User } from "@supabase/supabase-js";
import crypto from "crypto";

export const env = (k: string, fallback?: string) => {
  const v = process.env[k] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Variável de ambiente ausente: ${k}`);
  return v;
};

/** URL base do projeto Supabase, aceitando também a URL da API REST colada por engano (…/rest/v1/). */
export const supabaseUrl = () => (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");

let admin: SupabaseClient | null = null;
/** Cliente com a chave service_role: ignora RLS. Só no servidor. */
export function supabaseAdmin(): SupabaseClient {
  if (!admin) admin = createClient(supabaseUrl() || env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  return admin;
}

export const USER_DOMAIN = "users.transicao.app";
export const usernameToEmail = (u: string) => `${u.toLowerCase()}@${USER_DOMAIN}`;

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
export const fail = (code: string, message: string, status = 400) => json({ code, message }, status);

/** Lê o token de sessão enviado pelo navegador e devolve o usuário + se é membro. */
export async function requireUser(req: Request): Promise<{ user: User; isAdmin: boolean } | Response> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return fail("not_granted", "Faça login novamente.", 401);
  const sb = supabaseAdmin();
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return fail("not_granted", "Sessão expirada. Faça login novamente.", 401);
  const { data: m } = await sb.from("members").select("is_admin").eq("user_id", data.user.id).maybeSingle();
  if (!m) return fail("not_member", "Essa conta não faz parte do grupo.", 403);
  return { user: data.user, isAdmin: !!m.is_admin };
}

// ---------- estado assinado para o OAuth do Strava ----------
export function signState(userId: string) {
  const payload = `${userId}.${Date.now()}`;
  const sig = crypto.createHmac("sha256", env("STATE_SECRET")).update(payload).digest("base64url");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}
export function verifyState(state: string): string | null {
  try {
    const [userId, ts, sig] = Buffer.from(state, "base64url").toString().split(".");
    const expected = crypto.createHmac("sha256", env("STATE_SECRET")).update(`${userId}.${ts}`).digest("base64url");
    if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    if (Date.now() - Number(ts) > 15 * 60_000) return null;
    return userId;
  } catch { return null; }
}

// ---------- limite simples de uso por usuário (por instância) ----------
const hits = new Map<string, number[]>();
export function rateLimited(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  return arr.length > max;
}
