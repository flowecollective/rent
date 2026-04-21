-- Run this once in Supabase SQL Editor (https://supabase.com/dashboard/project/rhqkmzbrmyhsducqhzea/sql)

create table if not exists stylists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  stripe_customer_id text,
  payment_method_id text,
  payment_method_status text not null default 'none', -- 'none' | 'pending' | 'verified'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  stylist_id uuid not null references stylists(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  net_service_revenue numeric(10,2) not null,
  rent_amount numeric(10,2) not null default 600,
  commission_rate numeric(5,4) not null default 0.075,
  commission_amount numeric(10,2) not null,
  total_amount numeric(10,2) not null,
  stripe_invoice_id text,
  stripe_invoice_url text,
  status text not null default 'draft', -- 'draft' | 'sent' | 'processing' | 'paid' | 'failed'
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_invoices_stylist on invoices(stylist_id);
create index if not exists idx_invoices_week on invoices(week_start);
create index if not exists idx_invoices_status on invoices(status);

-- Row Level Security: deny all by default. Service role key bypasses RLS.
alter table stylists enable row level security;
alter table invoices enable row level security;
