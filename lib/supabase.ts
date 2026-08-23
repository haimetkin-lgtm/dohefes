import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// כשאין env vars (פיתוח מקומי בלי .env.local) - client דמה שלא קורס
const isConfigured = url.startsWith("http");

export const supabase = isConfigured ? createClient(url, key) : createClient("https://placeholder.supabase.co", "placeholder");

export const supabaseConfigured = isConfigured;

export interface CustomOrderRow {
  id: string;
  created_at: string;
  name: string;
  phone: string;
  email: string;
  description: string;
  file_paths: string[];
  price_nis: number;
  paid: boolean;
  status: "pending_payment" | "submitted" | "processing" | "ready" | "sent";
}

export const BASIC_PRICE_NIS = 980;
export const CUSTOM_PRICE_NIS = 1800;
export const CONSULTATION_PRICE_NIS = 1180;
