import { json, supabaseUrl } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Configuração pública que o navegador precisa para falar com o Supabase. */
export async function GET() {
  return json({
    supabaseUrl: supabaseUrl(),
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
    version: process.env.APP_VERSION || "", commit: process.env.APP_COMMIT || "", builtAt: process.env.APP_BUILT_AT || "",
  });
}
