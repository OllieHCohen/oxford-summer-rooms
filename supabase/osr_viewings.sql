-- ============================================================
-- Oxford Summer Rooms — osr_viewings table (viewing requests)
-- Run in the Supabase SQL editor (project rmoqgbrttdbgxntbxaxr).
-- ============================================================

create table if not exists public.osr_viewings (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  source          text,                       -- 'homepage' | 'property'
  property_id     int,
  property_address text,
  viewing_date    date,                        -- the viewing day (UK time)
  viewing_time    text default '16:00',
  viewing_label   text,                        -- human label, e.g. "Monday 15 June 2026 at 4:00pm"
  first_name      text not null,
  last_name       text not null,
  email           text not null,
  mobile          text not null,
  notes           text
);

create index if not exists osr_viewings_created_idx on public.osr_viewings (created_at desc);

-- RLS on, no public policies: only the osr-book-viewing edge function (service role) writes here.
alter table public.osr_viewings enable row level security;
