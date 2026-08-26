// Edge Function ראשונה בתשתית התשלום: יוצרת הזמנת תשלום + קישור Cardcom. **לא פרוסה עדיין**
// (ר' דוח ה-commit) - קוד בלבד, לבדיקה/סקירה. ר' GEN2_PAYMENT_ENTITLEMENT_DESIGN.md §4.2.
//
// adapter דק בלבד: כל הלוגיקה העסקית חיה ב-_shared/payment-order-service.ts (נבדקת ב-Vitest עם
// fakes, ר' payment-order-service.test.ts) - הקובץ הזה רק (א) מטפל בפרוטוקול HTTP (method/CORS/
// גודל body/Idempotency-Key/פענוח JSON) ו-(ב) בונה את התלויות האמיתיות (Supabase, Cardcom, Web
// Crypto, שעון) ומזריק אותן ל-createPaymentOrder.
//
// חתימה: POST בלבד. גוף: { reportId: string (uuid), productType: "baseReport"|"cashFlowAnalysis" }.
// חובה header: Idempotency-Key (uuid). שום שדה אחר לא נקרא מהלקוח - לא amount, לא currency, לא
// productName, לא כתובת callback כלשהי (כולן קבועות בצד שרת, ר' secrets למטה).
//
// **אין entitlement בשלב הזה** - רק "ניסיון תשלום" (payment_order). entitlement נוצרת רק על ידי
// cardcom-payment-indicator (עתידית, לא כתובה עדיין) אחרי אימות אמיתי מול Cardcom.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  isUuid,
  generateAccessToken,
  generateProviderOrderReference,
  hashAccessToken,
  parseAllowedOrigins,
  isAllowedOrigin,
  MAX_REQUEST_BODY_BYTES,
  byteLength,
} from "../_shared/payment-security.ts";
import { corsPreflightResponse, jsonResponse } from "../_shared/cors.ts";
import { isProductType, type ProductType } from "../_shared/payment-products.ts";
import { createCardcomClient } from "../_shared/cardcom-client.ts";
import { createPaymentOrder } from "../_shared/payment-order-service.ts";
import type { NewOrderInput, OrderRecord, PaymentOrderDatabase, ReportLookupResult } from "../_shared/payment-order-service.ts";

// --- Secrets: שמות בלבד, אין ערכים בקוד. ר' דוח ה-commit לרשימה המלאה. ---
// **אין CARDCOM_API_PASSWORD** - הוסר: לפי התיעוד הרשמי המאומת (ר' _shared/cardcom-client.ts),
// יצירת LowProfile (API Level 10) דורשת TerminalNumber+UserName בלבד, לא סיסמה נפרדת.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CARDCOM_TERMINAL_NUMBER = Deno.env.get("CARDCOM_TERMINAL_NUMBER") ?? "";
const CARDCOM_API_USERNAME = Deno.env.get("CARDCOM_API_USERNAME") ?? "";
const CARDCOM_INDICATOR_URL = Deno.env.get("CARDCOM_INDICATOR_URL") ?? "";
const CARDCOM_SUCCESS_URL = Deno.env.get("CARDCOM_SUCCESS_URL") ?? "";
const CARDCOM_ERROR_URL = Deno.env.get("CARDCOM_ERROR_URL") ?? "";
const ALLOWED_ORIGINS = parseAllowedOrigins(Deno.env.get("ALLOWED_ORIGINS"));
const ALLOWED_REQUEST_HEADERS = "Content-Type, Idempotency-Key";
// jsonResponse/corsPreflightResponse: חולצו ל-_shared/cors.ts (משותף גם עם get-product-access
// העתידית) - אותה התנהגות בדיוק כמו קודם, רק לא משוכפלת בקובץ הזה יותר.

interface RequestBody {
  reportId: string;
  productType: ProductType;
}

/** דוחה במפורש שדות שהלקוח אסור לו לשלוח (amount/currency/productName/כתובת callback כלשהי) -
 *  לא רק "מתעלמת" מהם בשקט. שדה עודף = קלט לא-תקין, לא ניחוש כוונה. */
function parseRequestBody(raw: unknown): { ok: true; body: RequestBody } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "invalid_body" };
  const record = raw as Record<string, unknown>;

  const allowedKeys = new Set(["reportId", "productType"]);
  const extraKeys = Object.keys(record).filter((key) => !allowedKeys.has(key));
  if (extraKeys.length > 0) return { ok: false, error: "unexpected_fields" };

  if (!isUuid(record.reportId)) return { ok: false, error: "invalid_report_id" };
  if (!isProductType(record.productType)) return { ok: false, error: "invalid_product_type" };

  return { ok: true, body: { reportId: record.reportId, productType: record.productType } };
}

// --- מימוש PaymentOrderDatabase האמיתי, מעל Supabase service_role client ---

type OrderRow = {
  id: string;
  status: OrderRecord["status"];
  report_id: string;
  product_type: ProductType;
  provider_order_reference: string;
  checkout_url: string | null;
};

function mapOrderRow(row: OrderRow): OrderRecord {
  return {
    id: row.id,
    status: row.status,
    reportId: row.report_id,
    productType: row.product_type,
    providerOrderReference: row.provider_order_reference,
    checkoutUrl: row.checkout_url,
  };
}

const ORDER_SELECT_COLUMNS = "id, status, report_id, product_type, provider_order_reference, checkout_url";

function buildDatabase(supabase: SupabaseClient): PaymentOrderDatabase {
  return {
    async getReportPaymentStatus(reportId: string): Promise<ReportLookupResult> {
      const { data, error } = await supabase.from("dohefes_reports").select("id, payment_status").eq("id", reportId).maybeSingle();
      if (error) throw error;
      if (!data) return { found: false, paymentStatus: null };
      return { found: true, paymentStatus: data.payment_status ?? null };
    },

    async findOrderByIdempotencyKey(idempotencyKey: string): Promise<OrderRecord | null> {
      const { data, error } = await supabase
        .from("dohefes_payment_orders")
        .select(ORDER_SELECT_COLUMNS)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle<OrderRow>();
      if (error) throw error;
      return data ? mapOrderRow(data) : null;
    },

    async insertOrder(input: NewOrderInput): Promise<OrderRecord> {
      const { data, error } = await supabase
        .from("dohefes_payment_orders")
        .insert({
          report_id: input.reportId,
          product_type: input.productType,
          expected_amount_agorot: input.amountAgorot,
          currency_code: input.currencyCode,
          status: "created",
          idempotency_key: input.idempotencyKey,
          provider_order_reference: input.providerOrderReference,
          access_token_hash: input.accessTokenHash,
        })
        .select(ORDER_SELECT_COLUMNS)
        .single<OrderRow>();
      if (error || !data) throw error ?? new Error("insertOrder: no row returned");
      return mapOrderRow(data);
    },

    async updateAccessTokenHash(orderId: string, accessTokenHash: string): Promise<void> {
      const { error } = await supabase.from("dohefes_payment_orders").update({ access_token_hash: accessTokenHash }).eq("id", orderId);
      if (error) throw error;
    },

    async markOrderPending(orderId: string, details: { cardcomLowProfileCode: string; checkoutUrl: string }): Promise<void> {
      const { error } = await supabase
        .from("dohefes_payment_orders")
        .update({ status: "pending", cardcom_low_profile_code: details.cardcomLowProfileCode, checkout_url: details.checkoutUrl })
        .eq("id", orderId);
      if (error) throw error;
    },

    async markOrderFailed(orderId: string, failureCode: string): Promise<void> {
      const { error } = await supabase.from("dohefes_payment_orders").update({ status: "failed", failure_code: failureCode }).eq("id", orderId);
      if (error) throw error;
    },
  };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return corsPreflightResponse(origin, ALLOWED_ORIGINS, ALLOWED_REQUEST_HEADERS);
  }

  if (!origin || !isAllowedOrigin(origin, ALLOWED_ORIGINS)) {
    return jsonResponse({ error: "origin_not_allowed" }, 403, origin, ALLOWED_ORIGINS);
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405, origin, ALLOWED_ORIGINS);
  }

  const idempotencyKey = req.headers.get("Idempotency-Key");
  if (!isUuid(idempotencyKey)) {
    return jsonResponse({ error: "missing_or_invalid_idempotency_key" }, 400, origin, ALLOWED_ORIGINS);
  }

  const contentLengthHeader = req.headers.get("Content-Length");
  if (contentLengthHeader && Number(contentLengthHeader) > MAX_REQUEST_BODY_BYTES) {
    return jsonResponse({ error: "body_too_large" }, 413, origin, ALLOWED_ORIGINS);
  }

  const rawBody = await req.text();
  if (byteLength(rawBody) > MAX_REQUEST_BODY_BYTES) {
    // בדיקה חוזרת על הגודל בפועל, לא רק על Content-Length (שניתן לזייף/להשמיט).
    return jsonResponse({ error: "body_too_large" }, 413, origin, ALLOWED_ORIGINS);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400, origin, ALLOWED_ORIGINS);
  }

  const parsed = parseRequestBody(parsedJson);
  if (!parsed.ok) {
    return jsonResponse({ error: parsed.error }, 400, origin, ALLOWED_ORIGINS);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "internal_error" }, 500, origin, ALLOWED_ORIGINS);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const cardcomClient = createCardcomClient({ terminalNumber: CARDCOM_TERMINAL_NUMBER, userName: CARDCOM_API_USERNAME });

  try {
    const result = await createPaymentOrder(
      {
        database: buildDatabase(supabase),
        cardcomClient,
        tokenGenerator: { generateAccessToken, hashAccessToken, generateProviderOrderReference },
        clock: () => new Date(),
        successRedirectUrl: CARDCOM_SUCCESS_URL,
        errorRedirectUrl: CARDCOM_ERROR_URL,
        indicatorUrl: CARDCOM_INDICATOR_URL,
      },
      { reportId: parsed.body.reportId, productType: parsed.body.productType, idempotencyKey }
    );
    return jsonResponse(result.body, result.status, origin, ALLOWED_ORIGINS);
  } catch {
    // תקלת DB/רשת בלתי-צפויה - לא חושפים פרטים פנימיים ללקוח.
    return jsonResponse({ error: "internal_error" }, 500, origin, ALLOWED_ORIGINS);
  }
});
