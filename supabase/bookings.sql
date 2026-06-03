-- ============================================================
-- Oxford Summer Rooms — bookings table
-- Run this in the Supabase SQL editor (project rmoqgbrttdbgxntbxaxr).
-- ============================================================

create table if not exists public.bookings (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  status                text not null default 'pending_payment',  -- pending_payment | reserved | cancelled

  -- what is being booked
  property_id           int  not null,
  room_id               int  not null,
  room_location         text,
  property_address      text,
  check_in              date not null,
  check_out             date not null,
  nights                int  not null,

  -- pricing (informational; the only charge taken now is the holding deposit)
  weekly_rent           numeric,
  cleaning_fee          numeric,
  estimated_stay_total  numeric,
  holding_deposit       numeric not null default 100,

  -- who is booking
  guest_first_name      text not null,
  guest_last_name       text not null,
  guest_email           text not null,
  guest_mobile          text not null,
  addr_line1            text not null,
  addr_line2            text,
  addr_city             text not null,
  addr_postcode         text not null,
  addr_country          text not null,

  -- stripe
  stripe_session_id     text,
  stripe_payment_intent text,
  stripe_status         text
);

create index if not exists bookings_room_idx   on public.bookings (room_id, status);
create index if not exists bookings_session_idx on public.bookings (stripe_session_id);

-- RLS ON, with NO public policies: the anon/public key can neither read nor
-- write this table. Only the edge functions (which use the service-role key)
-- can access it, and the service role bypasses RLS. This keeps guest PII and
-- booking data private while the rest of the site stays read-only-public.
alter table public.bookings enable row level security;
