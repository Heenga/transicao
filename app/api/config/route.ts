import { json } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Configuração pública que o navegador precisa para falar com o Supabase. */
export async function GET() {
  return json({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
  });
}
