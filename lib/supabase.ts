import { createClient } from "@supabase/supabase-js";

// Server-side only. Uses service role key to bypass RLS.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

export type Stylist = {
  id: string;
  name: string;
  email: string;
  stripe_customer_id: string | null;
  payment_method_id: string | null;
  payment_method_status: "none" | "pending" | "verified";
  service_fee_monthly_cap: number;
  created_at: string;
  updated_at: string;
};

export type Invoice = {
  id: string;
  stylist_id: string;
  week_start: string;
  week_end: string;
  net_service_revenue: number;
  rent_amount: number;
  service_fee_rate: number;
  service_fee_amount: number;
  total_amount: number;
  stripe_invoice_id: string | null;
  stripe_invoice_url: string | null;
  status: "draft" | "sent" | "processing" | "paid" | "failed";
  error_message: string | null;
  created_at: string;
  updated_at: string;
};
