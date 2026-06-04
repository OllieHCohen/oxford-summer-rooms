-- ============================================================
-- Oxford Summer Rooms — osr_bookings table (OSR-namespaced)
-- Run in the Supabase SQL editor (project rmoqgbrttdbgxntbxaxr).
--
-- If you already ran the earlier bookings.sql (which created a `bookings` table
-- with exactly these columns for OSR), the simplest path is to RENAME it:
--     alter table public.bookings rename to osr_bookings;
-- Otherwise, create it fresh below.
-- ============================================================

create table if not exists public.osr_bookings (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  status                text not null default 'pending_payment',  -- pending_payment | reserved | cancelled

  property_id           int  not null,
  room_id               int  not null,
  room_location         text,
  property_address      text,
  check_in              date not null,
  check_out             date not null,
  nights                int  not null,

  weekly_rent           numeric,
  cleaning_fee          numeric,
  estimated_stay_total  numeric,
  holding_deposit       numeric not null default 100,

  guest_first_name      text not null,
  guest_last_name       text not null,
  guest_email           text not null,
  guest_mobile          text not null,
  addr_line1            text not null,
  addr_line2            text,
  addr_city             text not null,
  addr_postcode         text not null,
  addr_country          text not null,

  stripe_session_id     text,
  stripe_payment_intent text,
  stripe_status         text
);

create index if not exists osr_bookings_room_idx    on public.osr_bookings (room_id, status);
create index if not exists osr_bookings_session_idx on public.osr_bookings (stripe_session_id);

-- RLS on, no public policies: only the OSR edge functions (service role) touch it.
alter table public.osr_bookings enable row level security;
