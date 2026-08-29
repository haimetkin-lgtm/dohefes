// Edge Function ראשונה בתשתית התשלום: יוצרת הזמנת תשלום + קישור Cardcom. **לא פרוסה עדיין**
// (ר' דוח ה-commit) - קוד בלבד, לבדיקה/סקירה. ר' GEN2_PAYMENT_ENTITLEMENT_DESIGN.md §4.2.
//
// adapter דק בלבד: כל הלוגיקה העסקית חיה ב-_shared/payment-order-service.ts (נבדקת ב-Vitest עם
// fakes, ר' payment-order-service.test.ts) - הקובץ הזה רק (א) מטפל בפרוטוקול HTTP (method/CORS/
// גודל body/Idempotency-Key/פענוח JSON) ו-(ב) בונה את התלויות האמיתיות (Supabase, Cardcom, Web
// Crypto, שעון) ומזריק אותן ל-createPaymentOrder.
//
// **Commit 6a**: החוזה הפך ל-union מבחין (ר' _shared/create-payment-order-request-parser.ts) -
//   - productType='baseReport': גוף { productType, dealType } - **בלי** reportId (הדוח עדיין
//     לא קיים - נוצר אטומית עם ההזמנה, ר' _shared/payment-order-service.ts::createBaseReportOrder).
//   - כל מוצר המשך: גוף { productType, reportId } - **בלי** dealType (כמו קודם).
// חובה header בשני המקרים: Idempotency-Key (uuid). שום שדה אחר לא נקרא מהלקוח - לא amount, לא
// currency, לא productName, לא כתובת callback כלשהי (כולן קבועות בצד שרת, ר' secrets למטה).
//
// **אין entitlement בשלב הזה** - רק "ניסיון תשלום" (payment_order, ולעבור baseReport - גם
// draft של דוח). entitlement נוצרת רק על ידי dohefes-cardcom-payment-indicator (אחרי אימות
// אמיתי מול Cardcom) - אותו RPC דבר בדיוק (dohefes_finalize_verified_payment), לא שונה כאן.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  isUuid,
  generateAccessToken,
  generateClaimToken,
  generateProviderOrderReference,
  hashAccessToken,
  parseAllowedOrigins,
  isAllowedOrigin,
  MAX_REQUEST_BODY_BYTES,
  byteLength,
} from "../_shared/payment-security.ts";
import { corsPreflightResponse, jsonResponse } from "../_shared/cors.ts";
import type { ProductType } from "../_shared/payment-products.ts";
import { createCardcomClient } from "../_shared/cardcom-client.ts";
import { parseCreatePaymentOrderRequestBody } from "../_shared/create-payment-order-request-parser.ts";
import { createPaymentOrder } from "../_shared/payment-order-service.ts";
import type {
  ClaimResult,
  CreateBaseReportDraftOutcome,
  InsertOrderResult,
  NewBaseReportDraftInput,
  NewOrderInput,
  OrderEntitlementLookup,
  OrderRecord,
  PaymentOrderAnomalyLogger,
  PaymentOrderDatabase,
} from "../_shared/payment-order-service.ts";

// --- Secrets: שמות בלבד, אין ערכים בקוד. ר' דוח ה-commit לרשימה המלאה. ---
// **אין CARDCOM_API_PASSWORD** - הוסר: לפי התיעוד הרשמי המאומת (ר' _shared/cardcom-client.ts),
// יצירת LowProfile (API Level 10) דורשת TerminalNumber+UserName בלבד, לא סיסמה נפרדת.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DOHEFES_CARDCOM_TERMINAL_NUMBER = Deno.env.get("DOHEFES_CARDCOM_TERMINAL_NUMBER") ?? "";
const DOHEFES_CARDCOM_API_USERNAME = Deno.env.get("DOHEFES_CARDCOM_API_USERNAME") ?? "";
const DOHEFES_CARDCOM_INDICATOR_URL = Deno.env.get("DOHEFES_CARDCOM_INDICATOR_URL") ?? "";
const DOHEFES_CARDCOM_SUCCESS_URL = Deno.env.get("DOHEFES_CARDCOM_SUCCESS_URL") ?? "";
const DOHEFES_CARDCOM_ERROR_URL = Deno.env.get("DOHEFES_CARDCOM_ERROR_URL") ?? "";
const DOHEFES_ALLOWED_ORIGINS = parseAllowedOrigins(Deno.env.get("DOHEFES_ALLOWED_ORIGINS"));
const ALLOWED_REQUEST_HEADERS = "Content-Type, Idempotency-Key";
// jsonResponse/corsPreflightResponse: חולצו ל-_shared/cors.ts (משותף גם עם dohefes-get-product-access
// העתידית) - אותה התנהגות בדיוק כמו קודם, רק לא משוכפלת בקובץ הזה יותר.

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

/** שם ה-index המדויק מ-migrations/20260828062934_dohefes_payment_infrastructure.sql (commit שישי) - חייב להישאר זהה מילה-במילה. משמש
 *  אך ורק לזיהוי **איזה** unique constraint נכשל בהודעת השגיאה של Postgres (הטבלה כוללת עוד
 *  כמה unique נפרדים - idempotency_key/provider_order_reference/וכו' - צריך להבחין ביניהם, לא
 *  להתייחס לכל 23505 כאילו הוא בהכרח ה-race שאנחנו יודעים לטפל בו). */
const ACTIVE_ORDER_INDEX_NAME = "idx_dohefes_payment_orders_one_active_per_report_product";

type EntitlementRow = { entitlement_status: OrderEntitlementLookup["entitlementStatus"] };

/** צורת השורה הגולמית שחוזרת מ-dohefes_create_base_report_payment_order (snake_case) - מיפוי
 *  מפורש ל-CreateBaseReportDraftOutcome (camelCase), אותו דפוס בדיוק כמו mapOrderRow/
 *  mapTrackingDataRow. outcome!=='created' לא נושא order כלל - report_id/order_id/וכו' חוזרים
 *  null מה-RPC באותם מקרים (ר' המיגרציה). */
type BaseReportDraftRpcRow = {
  outcome: "invalid_input" | "invalid_deal_type" | "idempotency_race" | "created";
  report_id: string | null;
  order_id: string | null;
  order_status: OrderRecord["status"] | null;
  provider_order_reference: string | null;
  checkout_url: string | null;
};

function mapBaseReportDraftRow(row: BaseReportDraftRpcRow): CreateBaseReportDraftOutcome {
  if (row.outcome === "invalid_deal_type") return { outcome: "invalid_deal_type" };
  if (row.outcome === "idempotency_race") return { outcome: "idempotency_race" };
  if (row.outcome !== "created" || !row.report_id || !row.order_id || !row.order_status || !row.provider_order_reference) {
    // 'invalid_input'/צורה לא-שלמה בלתי-צפויה - לא אמור לקרות בזרימה תקינה (ה-Edge Function
    // כבר סיננה קלט null לפני הקריאה) - נזרקת, לא "מתוקנת" בשקט. הופכת ל-internal_error
    // ב-catch הכללי של Deno.serve למטה, בדיוק כמו כל שגיאת DB בלתי-צפויה אחרת.
    throw new Error(`dohefes_create_base_report_payment_order: unexpected outcome shape (${row.outcome})`);
  }
  return {
    outcome: "created",
    order: {
      id: row.order_id,
      status: row.order_status,
      reportId: row.report_id,
      productType: "baseReport",
      providerOrderReference: row.provider_order_reference,
      checkoutUrl: row.checkout_url,
    },
  };
}

function buildDatabase(supabase: SupabaseClient): PaymentOrderDatabase {
  return {
    async findOrderByIdempotencyKey(idempotencyKey: string): Promise<OrderRecord | null> {
      const { data, error } = await supabase
        .from("dohefes_payment_orders")
        .select(ORDER_SELECT_COLUMNS)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle<OrderRow>();
      if (error) throw error;
      return data ? mapOrderRow(data) : null;
    },

    async findBlockingOrderForProduct(reportId: string, productType: ProductType): Promise<OrderRecord | null> {
      // תואם בדיוק לפרדיקט של idx_dohefes_payment_orders_one_active_per_report_product - ה-index
      // מבטיח שלכל היותר שורה אחת יכולה לתאום את שלושת התנאים האלה יחד, אז maybeSingle() בטוח.
      const { data, error } = await supabase
        .from("dohefes_payment_orders")
        .select(ORDER_SELECT_COLUMNS)
        .eq("report_id", reportId)
        .eq("product_type", productType)
        .in("status", ["created", "pending", "paid"])
        .maybeSingle<OrderRow>();
      if (error) throw error;
      return data ? mapOrderRow(data) : null;
    },

    async insertOrder(input: NewOrderInput): Promise<InsertOrderResult> {
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
      if (error) {
        // 23505 = unique_violation. בודקים ספציפית את שם ה-index שלנו (ולא סתם "כל 23505") -
        // התנגשות על idempotency_key/provider_order_reference וכו' היא תקלה אמיתית ולא-צפויה,
        // לא race שאנחנו יודעים לטפל בו - נשארת זורקת.
        if (error.code === "23505" && typeof error.message === "string" && error.message.includes(ACTIVE_ORDER_INDEX_NAME)) {
          return { ok: false };
        }
        throw error;
      }
      if (!data) throw new Error("insertOrder: no row returned");
      return { ok: true, order: mapOrderRow(data) };
    },

    async createBaseReportDraftAndOrder(input: NewBaseReportDraftInput): Promise<CreateBaseReportDraftOutcome> {
      // RPC יחיד - draft (dohefes_reports) + order (dohefes_payment_orders) נוצרים אטומית
      // בתוך dohefes_create_base_report_payment_order, לא בשתי קריאות Supabase נפרדות מכאן
      // (ר' migrations/20260829151144_dohefes_base_report_secure_backend.sql, RPC 1, ואת ההערה
      // המלאה ב-payment-order-service.ts על הבעיה שזה פותר).
      const { data, error } = await supabase
        .rpc("dohefes_create_base_report_payment_order", {
          p_deal_type: input.dealType,
          p_idempotency_key: input.idempotencyKey,
          p_amount_agorot: input.amountAgorot,
          p_currency_code: input.currencyCode,
          p_provider_order_reference: input.providerOrderReference,
          p_access_token_hash: input.accessTokenHash,
        })
        .single<BaseReportDraftRpcRow>();
      if (error) throw error;
      return mapBaseReportDraftRow(data);
    },

    async updateAccessTokenHash(orderId: string, accessTokenHash: string): Promise<void> {
      const { error } = await supabase.from("dohefes_payment_orders").update({ access_token_hash: accessTokenHash }).eq("id", orderId);
      if (error) throw error;
    },

    async claimCheckoutCreation(orderId: string, claimToken: string, leaseSeconds: number): Promise<ClaimResult> {
      // RPC בלבד - UPDATE אטומי יחיד בתבנית CAS (ר' dohefes_claim_checkout_creation,
      // migrations/20260828062934_dohefes_payment_infrastructure.sql commit שביעי) - לא select+update נפרד מכאן.
      const { data, error } = await supabase
        .rpc("dohefes_claim_checkout_creation", { p_order_id: orderId, p_claim_token: claimToken, p_lease_seconds: leaseSeconds })
        .single<{ claimed: boolean }>();
      if (error) throw error;
      return { claimed: data.claimed };
    },

    async releaseClaimAsPending(
      orderId: string,
      claimToken: string,
      details: { cardcomLowProfileCode: string; checkoutUrl: string }
    ): Promise<boolean> {
      // מותנה ב-checkout_claim_token תואם - אם מישהו אחר כבר תפס claim חדש בינתיים (חריגה
      // נדירה מה-lease), ה-UPDATE הזה לא יתאים לשום שורה (0 תוצאות), לא "דורס" claim זר.
      const { data, error } = await supabase
        .from("dohefes_payment_orders")
        .update({
          status: "pending",
          cardcom_low_profile_code: details.cardcomLowProfileCode,
          checkout_url: details.checkoutUrl,
          checkout_claim_token: null,
          checkout_claim_expires_at: null,
        })
        .eq("id", orderId)
        .eq("checkout_claim_token", claimToken)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      return data !== null;
    },

    async releaseClaimAsFailed(orderId: string, claimToken: string, failureCode: string): Promise<boolean> {
      // מותנה ב-checkout_claim_token תואם, בדיוק כמו releaseClaimAsPending - אם מישהו אחר כבר
      // תפס claim חדש בינתיים, ה-UPDATE הזה לא יתאים לשום שורה ולא "דורס" claim זר ל-failed.
      const { data, error } = await supabase
        .from("dohefes_payment_orders")
        .update({ status: "failed", failure_code: failureCode, checkout_claim_token: null, checkout_claim_expires_at: null })
        .eq("id", orderId)
        .eq("checkout_claim_token", claimToken)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      return data !== null;
    },

    async getEntitlement(reportId: string, productType: ProductType): Promise<OrderEntitlementLookup | null> {
      const { data, error } = await supabase
        .from("dohefes_product_entitlements")
        .select("entitlement_status")
        .eq("report_id", reportId)
        .eq("product_type", productType)
        .maybeSingle<EntitlementRow>();
      if (error) throw error;
      return data ? { entitlementStatus: data.entitlement_status } : null;
    },
  };
}

const anomalyLogger: PaymentOrderAnomalyLogger = {
  logAnomaly(event) {
    // תיעוד מינימלי, בלי PII/token/פרטי Cardcom - רק reason + reportId/productType (מזהים
    // טכניים). אין טבלת audit ייעודית בשלב הזה - console.warn בלבד, כמו recordSecurityEvent
    // ב-dohefes-cardcom-payment-indicator/index.ts (אותו דפוס בדיוק).
    console.warn("dohefes_payment_order_anomaly", event);
  },
};

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

  const idempotencyKey = req.headers.get("Idempotency-Key");
  if (!isUuid(idempotencyKey)) {
    return jsonResponse({ error: "missing_or_invalid_idempotency_key" }, 400, origin, DOHEFES_ALLOWED_ORIGINS);
  }

  const contentLengthHeader = req.headers.get("Content-Length");
  if (contentLengthHeader && Number(contentLengthHeader) > MAX_REQUEST_BODY_BYTES) {
    return jsonResponse({ error: "body_too_large" }, 413, origin, DOHEFES_ALLOWED_ORIGINS);
  }

  const rawBody = await req.text();
  if (byteLength(rawBody) > MAX_REQUEST_BODY_BYTES) {
    // בדיקה חוזרת על הגודל בפועל, לא רק על Content-Length (שניתן לזייף/להשמיט).
    return jsonResponse({ error: "body_too_large" }, 413, origin, DOHEFES_ALLOWED_ORIGINS);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400, origin, DOHEFES_ALLOWED_ORIGINS);
  }

  const parsed = parseCreatePaymentOrderRequestBody(parsedJson);
  if (!parsed.ok) {
    return jsonResponse({ error: parsed.error }, 400, origin, DOHEFES_ALLOWED_ORIGINS);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "internal_error" }, 500, origin, DOHEFES_ALLOWED_ORIGINS);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const cardcomClient = createCardcomClient({ terminalNumber: DOHEFES_CARDCOM_TERMINAL_NUMBER, userName: DOHEFES_CARDCOM_API_USERNAME });

  try {
    const result = await createPaymentOrder(
      {
        database: buildDatabase(supabase),
        cardcomClient,
        tokenGenerator: { generateAccessToken, hashAccessToken, generateProviderOrderReference, generateClaimToken },
        clock: () => new Date(),
        anomalyLogger,
        successRedirectUrl: DOHEFES_CARDCOM_SUCCESS_URL,
        errorRedirectUrl: DOHEFES_CARDCOM_ERROR_URL,
        indicatorUrl: DOHEFES_CARDCOM_INDICATOR_URL,
      },
      // parsed.body כבר הוא CreatePaymentOrderRequest-shaped (בלי idempotencyKey) - union מבחין
      // תואם אחד-לאחד למה ש-create-payment-order-request-parser.ts כבר אימת (baseReport עם
      // dealType בלי reportId, מוצר המשך עם reportId בלי dealType).
      { ...parsed.body, idempotencyKey }
    );
    return jsonResponse(result.body, result.status, origin, DOHEFES_ALLOWED_ORIGINS);
  } catch {
    // תקלת DB/רשת בלתי-צפויה - לא חושפים פרטים פנימיים ללקוח.
    return jsonResponse({ error: "internal_error" }, 500, origin, DOHEFES_ALLOWED_ORIGINS);
  }
});
