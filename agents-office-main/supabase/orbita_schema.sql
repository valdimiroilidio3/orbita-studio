-- ORBITA CRM schema. Run in the Supabase SQL editor before setting SUPABASE_URL/key.
-- Do not create anon/authenticated policies for this table: this app accesses it server-side only.
create table if not exists public.orbita_leads (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  company_name text not null,
  website text,
  category text,
  address text,
  city text,
  phone text,
  public_email text,
  osm_type text,
  osm_id text,
  source text not null default 'manual',
  source_url text,
  digital_presence text not null default 'unknown',
  lead_status text not null default 'new' check (lead_status in ('new','qualified','contacted','meeting','proposal','won','lost','suppressed')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orbita_leads enable row level security;
revoke all on table public.orbita_leads from anon, authenticated;
grant select, insert, update, delete on table public.orbita_leads to service_role;

create index if not exists orbita_leads_status_created_idx on public.orbita_leads (lead_status, created_at desc);
create index if not exists orbita_leads_city_idx on public.orbita_leads (city);

-- No policies are intentionally added. Use the service-role key only on the server and protect
-- ORBITA's API endpoints with ORBITA_API_TOKEN. Never place the service-role key in browser code.
