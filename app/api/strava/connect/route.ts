import { requireUser, json, env, signState } from "@/lib/server";

export const runtime = "nodejs";

/** Devolve o endereço de autorização do Strava para ESTE usuário (cada um conecta o próprio). */
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const url = new URL("https://www.strava.com/oauth/authorize");
  url.searchParams.set("client_id", env("STRAVA_CLIENT_ID"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", `${env("APP_URL")}/api/strava/callback`);
  url.searchParams.set("approval_prompt", "auto");
  url.searchParams.set("scope", "read,activity:read_all,profile:read_all");
  url.searchParams.set("state", signState(auth.user.id));
  return json({ url: url.toString() });
}
