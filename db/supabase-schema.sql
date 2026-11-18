-- RESOLVER: tabla de almacenamiento en Supabase.
-- Pégalo en Supabase → SQL Editor → Run. Es seguro ejecutarlo más de una vez.

create table if not exists public.resolver_records (
  id text primary key,
  collection text not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists resolver_records_collection_idx on public.resolver_records (collection);

-- Seguridad: con RLS activo y sin políticas, nadie con la clave pública (anon)
-- puede leer ni escribir. Solo el servidor, con la clave de servicio, accede a la tabla.
alter table public.resolver_records enable row level security;
