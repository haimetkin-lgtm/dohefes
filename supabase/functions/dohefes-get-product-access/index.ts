// Edge Function שלישית בתשתית התשלום: בדיקת גישה למוצר עבור דוח קיים. **לא פרוסה עדיין** (ר'
// דוח ה-commit) - קוד בלבד, לבדיקה/סקירה.
//
// adapter דק בלבד: כל הלוגיקה חיה ב-_shared/payment-access-service.ts (נבדקת ב-Vitest עם
// fakes, ר' payment-access-service.test.ts) - הקובץ הזה רק (א) מטפל בפרוטוקול HTTP (method/CORS/
// גודל body/פענוח JSON/חילוץ הטוקן מה-header) ו-(ב) בונה את התלויות האמיתיות (Supabase, Web
// Crypto) ומזריק אותן ל-checkProductAccess.
//
// נקראת מהדפדפן (כמו dohefes-create-payment-order) - **צריכה CORS**, בניגוד ל-dohefes-cardcom-payment-indicator.
//
// חתימה: POST בלבד. גוף: { reportId: string (uuid), productType: "baseReport"|"cashFlowAnalysis"|"trackingReports" }.
// הטוקן הגולמי מגיע ב-header ייעודי (X-Access-Token), **לא** בגוף הבקשה ולא ב-query string -
// כדי לא להשאיר סוד ב-URL/body שנוטים יותר להגיע ללוגים חיצוניים (proxies וכו') מאשר headers.
// שום שדה אחר לא נקרא מהלקוח - **לא** סטטוס תשלום, **לא** מחיר, **לא** entitlement - כל אלה
// נגזרים כאן, בצד שרת, מהטוקן בלבד (ר' payment-access-service.ts).
//
// **תגובה אחידה בכוונה**: { status: "active" | "pending" | "unavailable" } - שום דבר אחר. אותה
// תגובה בדיוק (unavailable) לדוח לא קיים, טוקן שגוי, או מוצר שלא נרכש - אי אפשר להבחין ביניהם
// מבחוץ. **לעולם לא מוחזר**: מזהה הזמנה/entitlement, פרטי Cardcom, סכום/מחיר, PII, או מידע על
// מוצר אחר מזה שנשאל עליו.
//
// **קריאה בלבד** - אין UPDATE/INSERT/DELETE בקובץ הזה או ב-_shared/payment-access-service.ts,
// בשום מקרה. אין פתיחת RLS אנונימי כלשהי, אין גישה ישירה מהדפדפן לטבלאות - הדפדפן ממשיך לדבר
// אך ורק עם ה-Edge Function הזו, שמשתמשת ב-service_role (עוקף RLS) אחרי אימות הטוקן בעצמה.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { corsPreflightResponse, jsonResponse } from "../_shared/cors.ts";
import { isUuid, hashAccessToken, parseAllowedOrigins, isAllowedOrigin, MAX_REQUEST_BODY_BYTES, byteLength } from "../_shared/payment-security.ts";
import { isProductType, type ProductType } from "../_shared/payment-products.ts";
import { checkProductAccess } from "../_shared/payment-access-service.ts";
import type { AccessEntitlementLookup, AccessOrderLookup, PaymentAccessDatabase, ProductAccessStatus } from "../_shared/payment-access-service.ts";

// --- Secrets: שמות בלבד, אין ערכים בקוד. ---
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DOHEFES_ALLOWED_ORIGINS = parseAllowedOrigins(Deno.env.get("DOHEFES_ALLOWED_ORIGINS"));

const ALLOWED_REQUEST_HEADERS = "Content-Type, X-Access-Token";

interface RequestBody {
  reportId: string;
  productType: ProductType;
}

/** דוחה במפורש שדות עודפים (amount/paymentStatus/entitlement וכו', ר' הערת הכותרת) - לא רק
 *  מתעלמת מהם - שדה עודף = קלט לא-תקין, לא ניחוש כוונה. אותו דפוס בדיוק כמו dohefes-create-payment-order. */
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

type OrderAccessRow = {
  report_id: string;
  product_type: string;
  status: AccessOrderLookup["status"];
  verified_at: string | null;
  paid_at: string | null;
};

type EntitlementAccessRow = {
  entitlement_status: AccessEntitlementLookup["entitlementStatus"];
};

function buildDatabase(supabase: SupabaseClient): PaymentAccessDatabase {
  return {
    async getOrderByAccessTokenHash(accessTokenHash: string): Promise<AccessOrderLookup | null> {
      const { data, error } = await supabase
        .from("dohefes_payment_orders")
        .select("report_id, product_type, status, verified_at, paid_at")
        .eq("access_token_hash", accessTokenHash)
        .maybeSingle<OrderAccessRow>();
      if (error) throw error;
      if (!data) return null;
      return {
        reportId: data.report_id,
        productType: data.product_type,
        status: data.status,
        verifiedAt: data.verified_at,
        paidAt: data.paid_at,
      };
    },

    async getEntitlement(reportId: string, productType: string): Promise<AccessEntitlementLookup | null> {
      const { data, error } = await supabase
        .from("dohefes_product_entitlements")
        .select("entitlement_status")
        .eq("report_id", reportId)
        .eq("product_type", productType)
        .maybeSingle<EntitlementAccessRow>();
      if (error) throw error;
      if (!data) return null;
      return { entitlementStatus: data.entitlement_status };
    },
  };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return corsPreflightResponse(origin, DOHEFES_ALLOWED_ORIGINS, ALLOWED_REQUEST_HEADERS);
  }

  if (!origin || !isAllowedOrigin(origin, DOHEFES_ALLOWED_ORIGINS)) {
    return jsonResponse({ error: "origin_not_allowed" }, 403, origin, DOHEFES_ALLOWED_ORIGINS);
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405, origin, DOHEFES_ALLOWED_ORIGINS);
  }

  const rawAccessToken = req.headers.get("X-Access-Token");
  if (!rawAccessToken) {
    return jsonResponse({ error: "missing_access_token" }, 400, origin, DOHEFES_ALLOWED_ORIGINS);
  }

  const contentLengthHeader = req.headers.get("Content-Length");
  if (contentLengthHeader && Number(contentLengthHeader) > MAX_REQUEST_BODY_BYTES) {
    return jsonResponse({ error: "body_too_large" }, 413, origin, DOHEFES_ALLOWED_ORIGINS);
  }

  const rawBody = await req.text();
  if (byteLength(rawBody) > MAX_REQUEST_BODY_BYTES) {
    return jsonResponse({ error: "body_too_large" }, 413, origin, DOHEFES_ALLOWED_ORIGINS);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400, origin, DOHEFES_ALLOWED_ORIGINS);
  }

  const parsed = parseRequestBody(parsedJson);
  if (!parsed.ok) {
    return jsonResponse({ error: parsed.error }, 400, origin, DOHEFES_ALLOWED_ORIGINS);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "internal_error" }, 500, origin, DOHEFES_ALLOWED_ORIGINS);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  try {
    const result: { status: ProductAccessStatus } = await checkProductAccess(
      { database: buildDatabase(supabase), tokenHasher: { hashAccessToken } },
      { reportId: parsed.body.reportId, productType: parsed.body.productType, rawAccessToken }
    );
    return jsonResponse(result, 200, origin, DOHEFES_ALLOWED_ORIGINS);
  } catch {
    // תקלת DB/רשת בלתי-צפויה - לא חושפים פרטים פנימיים ללקוח, ולא מחזירים "unavailable" (שהוא
    // תשובה תקנית ל"אין גישה", לא ל"קרתה תקלה") - 500 גנרי, כמו dohefes-create-payment-order.
    return jsonResponse({ error: "internal_error" }, 500, origin, DOHEFES_ALLOWED_ORIGINS);
  }
});
