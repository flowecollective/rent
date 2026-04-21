-- Run in Supabase SQL Editor (https://supabase.com/dashboard/project/rhqkmzbrmyhsducqhzea/sql)
-- Adds per-stylist billing model support:
--   - rent_plus_fee: flat weekly rent + % service fee (existing default)
--   - percent_rent: % of revenue with a weekly minimum (no flat rent)

-- Stylists: billing model + per-stylist rates + minimum
alter table stylists
  add column if not exists billing_model text not null default 'rent_plus_fee',
  add column if not exists fee_rate numeric(5,4) not null default 0.075,
  add column if not exists weekly_rent numeric(10,2) not null default 600,
  add column if not exists minimum_remit numeric(10,2);

-- Invoices: snapshot of which model was used + whether the minimum kicked in
alter table invoices
  add column if not exists billing_model text not null default 'rent_plus_fee',
  add column if not exists minimum_applied boolean not null default false;
