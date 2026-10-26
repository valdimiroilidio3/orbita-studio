-- Órbita Studio — esquema do CRM (opcional).
-- Sem Supabase, os leads vivem em data/orbita-leads.json. Com Supabase, é esta tabela que os
-- guarda: `dedupe_key` único é o que impede duplicados (osm:id → domínio → nome+cidade).
-- A chave service-role só existe no servidor; não há políticas públicas.

create extension if not exists "pgcrypto";

create table if not exists public.orbita_leads (
  id                uuid primary key default gen_random_uuid(),
  dedupe_key        text unique not null,
  company_name      text not null,
  website           text,
  category          text,
  address           text,
  city              text,
  phone             text,
  public_email      text,
  osm_type          text,
  osm_id            text,
  source            text not null default 'manual',
  source_url        text,
  digital_presence  text default 'unknown',
  lead_status       text not null default 'new'
                    check (lead_status in ('new','qualified','contacted','meeting','proposal','won','lost','suppressed')),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists orbita_leads_status_idx on public.orbita_leads (lead_status);
create index if not exists orbita_leads_created_idx on public.orbita_leads (created_at desc);

alter table public.orbita_leads enable row level security;

-- Sem políticas: nem anon nem authenticated leem ou escrevem. Só a service-role (servidor) passa.
revoke all on public.orbita_leads from anon, authenticated;
