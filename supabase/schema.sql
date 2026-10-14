-- =====================================================================
-- Transição — banco de dados (rode inteiro no Supabase: SQL Editor → New query → Run)
-- =====================================================================
-- Modelo: um "documento" por assunto, endereçado por caminho.
--   data/users/<uid>/profile | activities | plan | chat | checkins | diet | weights   → privado do atleta
--   team/<uid>     → resumo público de treino (placar do grupo)
--   kudos/<uid>    → aplausos que o atleta deu
--   config/race    → a prova do grupo (só organizador edita)
-- Organizadores (tabela admins) leem tudo, para backup e acompanhamento.
-- =====================================================================

create table if not exists public.members (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  username   text unique not null check (username ~ '^[a-z0-9._]{3,20}$'),
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.documents (
  path       text primary key,
  owner      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists documents_path_prefix on public.documents (path text_pattern_ops);

-- histórico: cada gravação guarda a versão anterior (permite recuperar dados apagados por engano)
create table if not exists public.documents_history (
  id         bigserial primary key,
  path       text not null,
  owner      uuid,
  data       jsonb,
  changed_at timestamptz not null default now()
);
create index if not exists documents_history_path on public.documents_history (path, changed_at desc);

create table if not exists public.strava_tokens (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  athlete_id    bigint,
  access_token  text not null,
  refresh_token text not null,
  expires_at    bigint not null,
  scope         text,
  updated_at    timestamptz not null default now()
);

-- ---------- funções auxiliares ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid() and is_admin);
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid());
$$;

create or replace function public.touch_document() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    insert into public.documents_history(path, owner, data) values (old.path, old.owner, old.data);
  elsif tg_op = 'DELETE' then
    insert into public.documents_history(path, owner, data) values (old.path, old.owner, old.data);
    return old;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists documents_touch on public.documents;
create trigger documents_touch before insert or update or delete on public.documents
for each row execute function public.touch_document();

-- ---------- segurança (Row Level Security) ----------
alter table public.members           enable row level security;
alter table public.documents         enable row level security;
alter table public.documents_history enable row level security;
alter table public.strava_tokens     enable row level security;   -- sem políticas: só o servidor acessa

drop policy if exists members_read on public.members;
create policy members_read on public.members for select using (public.is_member());

drop policy if exists docs_read on public.documents;
create policy docs_read on public.documents for select using (
  public.is_member() and (
       path like 'team/%' or path like 'kudos/%' or path like 'config/%'
    or path like 'data/users/' || auth.uid()::text || '/%'
    or public.is_admin()
  )
);

drop policy if exists docs_insert on public.documents;
create policy docs_insert on public.documents for insert with check (
  public.is_member() and (
       (owner = auth.uid() and (
            path = 'team/'  || auth.uid()::text
         or path = 'kudos/' || auth.uid()::text
         or path like 'data/users/' || auth.uid()::text || '/%'))
    or (path like 'config/%' and public.is_admin())
  )
);

drop policy if exists docs_update on public.documents;
create policy docs_update on public.documents for update using (
  public.is_member() and (
       (owner = auth.uid() and (
            path = 'team/'  || auth.uid()::text
         or path = 'kudos/' || auth.uid()::text
         or path like 'data/users/' || auth.uid()::text || '/%'))
    or (path like 'config/%' and public.is_admin())
  )
) with check (
  (owner = auth.uid()) or (path like 'config/%' and public.is_admin())
);

drop policy if exists docs_delete on public.documents;
create policy docs_delete on public.documents for delete using (
  owner = auth.uid() and path like 'data/users/' || auth.uid()::text || '/%'
);

drop policy if exists history_read on public.documents_history;
create policy history_read on public.documents_history for select using (public.is_admin());

-- prova inicial do grupo
insert into public.documents (path, owner, data)
select 'config/race', u.id, '{"name":"All Limits","label":"High Limits","type":"olimpico","date":"2027-05-30","time":"06:30","place":"Lagoa dos Ingleses · Alphaville, Nova Lima – MG"}'::jsonb
from auth.users u order by u.created_at limit 1
on conflict (path) do nothing;
