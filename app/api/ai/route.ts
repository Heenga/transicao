import Anthropic from "@anthropic-ai/sdk";
import { requireUser, json, fail, rateLimited } from "@/lib/server";

export const runtime = "nodejs";
export const maxDuration = 300; // geração do plano pode levar mais de 1 minuto

/**
 * Proxy seguro para a API da Anthropic. A chave fica só no servidor.
 * O navegador envia { messages, tools?, tier?, maxTokens? } e recebe { content, stop_reason }.
 * Ferramentas (registrar treino, peso, ajustar plano...) são executadas no navegador,
 * que devolve os resultados numa nova chamada.
 */
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  if (!process.env.ANTHROPIC_API_KEY) return fail("ai_off", "IA ainda não configurada: falta ANTHROPIC_API_KEY no Vercel.", 503);
  if (rateLimited("ai:" + auth.user.id, 40, 10 * 60_000)) return fail("rate_limited", "Muitas mensagens seguidas. Espere alguns minutos.", 429);

  let body: any;
  try { body = await req.json(); } catch { return fail("bad_request", "Requisição inválida."); }
  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages?.length) return fail("bad_request", "Sem mensagens.");
  if (JSON.stringify(messages).length > 1_500_000) return fail("too_large", "Mensagem grande demais (imagem muito pesada?).", 413);

  const tier = body.tier === "quick" ? "quick" : body.tier === "complex" ? "complex" : "default";
  const model = tier === "quick" ? (process.env.AI_MODEL_QUICK || "claude-haiku-5-5") : (process.env.AI_MODEL || "claude-sonnet-5-5");
  const maxTokens = Math.min(Number(body.maxTokens) || (tier === "complex" ? 12000 : 4000), 16000);
  const tools = Array.isArray(body.tools) && body.tools.length
    ? body.tools.map((t: any) => ({ name: String(t.name), description: String(t.description || ""), input_schema: t.input_schema || { type: "object", properties: {} } }))
    : undefined;

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await client.messages.create({
      model, max_tokens: maxTokens, messages,
      ...(tools ? { tools } : {}),
      ...(body.system ? { system: String(body.system).slice(0, 20000) } : {}),
    } as any);
    return json({ content: res.content, stop_reason: res.stop_reason, model: res.model });
  } catch (e: any) {
    const status = e?.status || 500;
    if (status === 429) return fail("rate_limited", "A IA está sobrecarregada. Tente em alguns segundos.", 429);
    if (status === 401) return fail("ai_off", "Chave da Anthropic inválida. Confira ANTHROPIC_API_KEY.", 503);
    return fail("upstream_error", "A IA não respondeu. Tente de novo.", 502);
  }
}
