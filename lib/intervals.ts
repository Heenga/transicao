import crypto from "crypto";
import { supabaseAdmin, env } from "./server";

/* Integração com o intervals.icu (que manda os treinos planejados para o Garmin Connect).
   A chave de API de cada pessoa fica criptografada no banco: só o servidor consegue ler. */
const API = "https://intervals.icu/api/v1";
const secretPath = (userId: string) => `secret/intervals/${userId}`;
const cryptoKey = () => crypto.createHash("sha256").update(env("STATE_SECRET")).digest();

export function encrypt(text: string) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", cryptoKey(), iv);
  const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString("base64")).join(".");
}
function decrypt(blob: string) {
  const [iv, tag, enc] = blob.split(".").map(s => Buffer.from(s, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", cryptoKey(), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}
const authHeader = (apiKey: string) => "Basic " + Buffer.from("API_KEY:" + apiKey).toString("base64");

export async function intervalsFetch(apiKey: string, path: string, init: RequestInit = {}) {
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(API + path, { ...init, signal: ctl.signal, headers: { authorization: authHeader(apiKey), "content-type": "application/json", ...(init.headers || {}) } });
    const text = await r.text();
    let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: r.status, ok: r.ok, data };
  } finally { clearTimeout(to); }
}

export async function saveIntervals(userId: string, apiKey: string, athlete: { id: string; name: string }) {
  await supabaseAdmin().from("documents").upsert({ path: secretPath(userId), owner: userId,
    data: { enc: encrypt(apiKey), athleteId: athlete.id, athleteName: athlete.name, connectedAt: new Date().toISOString() } }, { onConflict: "path" });
}
export async function loadIntervals(userId: string): Promise<{ apiKey: string; athleteId: string; athleteName: string } | null> {
  const { data } = await supabaseAdmin().from("documents").select("data").eq("path", secretPath(userId)).maybeSingle();
  if (!data?.data?.enc) return null;
  try { return { apiKey: decrypt(data.data.enc), athleteId: data.data.athleteId, athleteName: data.data.athleteName }; } catch { return null; }
}
export async function deleteIntervals(userId: string) {
  await supabaseAdmin().from("documents").delete().eq("path", secretPath(userId));
}
