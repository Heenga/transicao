# Transição · All Limits

App de treino de triatlo do grupo (4 pessoas) para a **All Limits – High Limits** (distância olímpica, Lagoa dos Ingleses).

- Login com **usuário + senha**; cada pessoa tem a própria conta e os próprios dados.
- Cadastro de atleta, painel com condicionamento (0–100), check-in de recuperação e peso semanal.
- Treinos: plano de 4 semanas gerado por IA (método embutido) + registro manual detalhado.
- Strava: **cada pessoa conecta a própria conta** (Garmin e Apple Watch chegam via Strava).
- Alimentação com análise por texto ou **foto do prato**.
- Coach por chat (IA) que registra sono, treinos, dores, peso e ajusta o plano.
- Grupo: placar, conquistas e aplausos.

**Tecnologia:** Next.js no Vercel (rotas seguras em `app/api`), Supabase (login + banco Postgres), API da Anthropic (IA), API do Strava.

---

## Passo 1 — Supabase (banco e login) · ~10 min

1. Crie a conta em <https://supabase.com> → **New project**.
   - Nome: `transicao` · Região: **South America (São Paulo)** · anote a senha do banco.
2. Quando o projeto terminar de criar, vá em **SQL Editor → New query**, cole o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e clique **Run**. Deve aparecer "Success".
3. Vá em **Authentication → Sign In / Providers → Email** e:
   - deixe **Email** ligado;
   - **desligue "Confirm email"** (o app usa usuário + senha, não manda e-mail).
4. Vá em **Project Settings → API** e copie:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (**secreta**, nunca coloque no navegador)

Onde ficam os dados: **Table Editor → documents**. Cada linha é um assunto de um atleta (`data/users/<id>/profile`, `/activities`, `/plan`, `/checkins`, `/weights`, `/diet`, `/chat`). Toda alteração guarda a versão anterior em `documents_history`, então nada se perde se alguém apagar por engano.

## Passo 2 — Strava · ~5 min

1. Entre em <https://www.strava.com/settings/api> e crie o aplicativo:
   - **Application Name:** Transição · **Category:** Training · **Website:** a URL do Vercel
   - **Authorization Callback Domain:** só o domínio, sem `https://` (ex.: `transicao.vercel.app`; para testar local use `localhost`)
2. Copie **Client ID** → `STRAVA_CLIENT_ID` e **Client Secret** → `STRAVA_CLIENT_SECRET`.
3. **Limite de atletas:** apps novos do Strava começam autorizando só o dono (você). Para seus 3 amigos conectarem, peça o aumento de capacidade no próprio painel da API (formulário do Strava) ou por developers@strava.com, explicando que é um app privado para 4 atletas. Enquanto não liberar, eles usam o **registro manual** e o coach normalmente.

## Passo 3 — Anthropic (IA) · ~3 min

1. <https://console.anthropic.com> → **API Keys → Create key** → `ANTHROPIC_API_KEY`.
2. Coloque crédito em **Billing**. Uso esperado para 4 pessoas é baixo (o chat usa `claude-sonnet-5-5`, tarefas rápidas usam `claude-haiku-5-5`).

## Passo 4 — Vercel · ~5 min

1. <https://vercel.com/new> → **Import** o repositório `Heenga/transicao`.
2. Em **Environment Variables**, cadastre todas as variáveis de [`.env.example`](.env.example):

| Variável | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | do Passo 1 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | do Passo 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | do Passo 1 |
| `GROUP_INVITE_CODE` | código que seus amigos vão digitar ao criar a conta |
| `ADMIN_USERNAMES` | seu usuário (ex.: `henrique`) — pode editar a prova e exportar dados do grupo |
| `MAX_MEMBERS` | `4` |
| `ANTHROPIC_API_KEY` | do Passo 3 |
| `AI_MODEL` / `AI_MODEL_QUICK` | `claude-sonnet-5-5` / `claude-haiku-5-5` |
| `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` | do Passo 2 |
| `APP_URL` | a URL final, ex.: `https://transicao.vercel.app` (sem barra no fim) |
| `STATE_SECRET` | um texto aleatório longo (ex.: gere em <https://1password.com/password-generator>) |

3. **Deploy.** Depois do primeiro deploy, confira se `APP_URL` bate com a URL real; se mudou, ajuste e clique **Redeploy**. Atualize também o **Callback Domain** no Strava.

## Passo 5 — Primeiro acesso

1. Abra a URL → **Criar conta** → usuário `henrique`, senha (4+ caracteres, pode ser só números) e o código do grupo.
2. Faça o cadastro de atleta → **Configurações → Conexões → Conectar meu Strava**.
3. Mande para os amigos: o link + o código do grupo. Cada um cria a própria conta.

## Rodar no computador (opcional)

```bash
npm install
cp .env.example .env.local   # preencha os valores
npm run dev                  # http://localhost:3000
```

## Estrutura

```
app/api/signup              cria conta (confere código do grupo e limite de membros)
app/api/me                  quem está logado, organizador?, Strava conectado?
app/api/ai                  proxy da IA (chave fica no servidor)
app/api/strava/connect      inicia o login no Strava da pessoa
app/api/strava/callback     recebe a autorização e guarda os tokens (só o servidor lê)
app/api/strava/activities   treinos e zonas do Strava da pessoa
app/api/strava/disconnect   desconecta
lib/                        utilitários do servidor (Supabase admin, Strava)
public/index.html           app (tela de login + painel)
public/shim.js              login, banco, IA e downloads no navegador
public/app.js · app.css     interface e lógica de treino
supabase/schema.sql         tabelas e regras de segurança
```

## Segurança

- Senhas ficam no Supabase Auth (com hash). O app nunca vê a senha depois do login.
- Regras no banco (RLS): cada atleta só lê e grava a própria pasta; o placar (`team/`) é visível ao grupo; a prova (`config/`) só o organizador altera; organizadores leem tudo para backup.
- Tokens do Strava ficam numa tabela sem acesso pelo navegador.
- Chave da Anthropic e `service_role` ficam só no servidor (Vercel).
- Para redefinir a senha de alguém: Supabase → **Authentication → Users** → usuário → *Reset password* / *Update user*.
