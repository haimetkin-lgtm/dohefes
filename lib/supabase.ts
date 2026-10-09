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

// כתובת שרת התשלום. חייבת להיות www: הכתובת בלי www מפנה (308), ודפדפן דוחה בקשת preflight שמקבלת הפניה.
export const DECISIONS_API = "https://www.insure.co.il/api/decisions";

// יוצר דף תשלום בשרת. הסכום נקבע שם, לא לפי מה שהדפדפן שולח.
export async function startCustomCheckout(orderId: string): Promise<string> {
  const res = await fetch(`${DECISIONS_API}/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product: "dohefes", kind: "custom", case_id: orderId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.payment_url) throw new Error(body.error || "checkout_failed");
  return body.payment_url as string;
}

// סטטוס ההזמנה של הלקוח עצמו לפי מזהה (בלי פרטים אישיים), כדי לדעת אם התשלום אושר.
export async function getCustomOrderStatus(id: string): Promise<{ id: string; paid: boolean; status: CustomOrderRow["status"] } | null> {
  const { data, error } = await supabase.rpc("dohefes_get_custom_order", { p_id: id });
  return error || !data ? null : (data as { id: string; paid: boolean; status: CustomOrderRow["status"] });
}
