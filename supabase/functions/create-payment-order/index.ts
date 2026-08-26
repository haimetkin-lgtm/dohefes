// Edge Function ראשונה בתשתית התשלום: יוצרת הזמנת תשלום + קישור Cardcom. **לא פרוסה עדיין**
// (ר' דוח ה-commit) - קוד בלבד, לבדיקה/סקירה. ר' GEN2_PAYMENT_ENTITLEMENT_DESIGN.md §4.2.
//
// חתימה: POST בלבד. גוף: { reportId: string (uuid), productType: "baseReport"|"cashFlowAnalysis" }.
// חובה header: Idempotency-Key (uuid). שום שדה אחר לא נקרא מהלקוח - לא amount, לא currency, לא
// productName, לא כתובת callback כלשהי (כולן קבועות בצד שרת, ר' §6 secrets למטה).
//
// תגובה מוצלחת (הזמנה חדשה/pending): { orderId, checkoutUrl, accessToken, status: "pending" }.
// תגובה על הזמנה ששולמה כבר (idempotency-key חוזר על order paid): { status: "paid" } בלבד -
// בלי accessToken/checkoutUrl/orderId, ר' סעיף Token למטה.
//
// **אין entitlement בשלב הזה** - הפונקציה הזו רק יוצרת "ניסיון תשלום" (payment_order). entitlement
// נוצרת רק על ידי cardcom-payment-indicator (עתידית) אחרי אימות אמיתי מול Cardcom.

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
import { isProductType, getProduct, type ProductType } from "../_shared/payment-products.ts";
import { createLowProfile } from "../_shared/cardcom-client.ts";

// --- Secrets: שמות בלבד, אין ערכים בקוד. ר' דוח ה-commit לרשימה המלאה ולממצא ה-secret החסר. ---
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CARDCOM_TERMINAL_NUMBER = Deno.env.get("CARDCOM_TERMINAL_NUMBER") ?? "";
const CARDCOM_API_USERNAME = Deno.env.get("CARDCOM_API_USERNAME") ?? "";
// ר' cardcom-client.ts - שם secret נוסף שאני מוסיף כאן, לא היה ברשימה שסופקה, ממצא לדיווח.
const CARDCOM_API_PASSWORD = Deno.env.get("CARDCOM_API_PASSWORD") ?? "";
const CARDCOM_INDICATOR_URL = Deno.env.get("CARDCOM_INDICATOR_URL") ?? "";
const CARDCOM_SUCCESS_URL = Deno.env.get("CARDCOM_SUCCESS_URL") ?? "";
const CARDCOM_ERROR_URL = Deno.env.get("CARDCOM_ERROR_URL") ?? "";
const ALLOWED_ORIGINS = parseAllowedOrigins(Deno.env.get("ALLOWED_ORIGINS"));

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  // CORS: רק origin מפורש מתוך ALLOWED_ORIGINS, לעולם לא "*". בלי Allow-Credentials - לא נדרש,
  // אין cookies/session בזרימה הזו.
  if (origin && isAllowedOrigin(origin, ALLOWED_ORIGINS)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function corsPreflightResponse(origin: string | null): Response {
  const headers = new Headers();
  if (origin && isAllowedOrigin(origin, ALLOWED_ORIGINS)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key");
    headers.set("Vary", "Origin");
  }
  return new Response(null, { status: 204, headers });
}

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

type OrderRow = {
  id: string;
  status: string;
  report_id: string;
  product_type: ProductType;
  provider_order_reference: string;
  cardcom_low_profile_code: string | null;
  checkout_url: string | null;
};

/**
 * שרשרת הטיפול המלאה - מתועדת שלב-שלב לפי הרצף שהתבקש:
 * 1. בוחרת מחיר מה-registry (getProduct, לא מהלקוח).
 * 2/3. בודקת idempotency-key קיים לפני שיוצרת הזמנה חדשה - לא יוצרת order נוסף ב-retry.
 * 4. פונה ל-Cardcom (createLowProfile) רק כשצריך (הזמנה חדשה, או pending בלי checkout_url עדיין).
 * 5-7. שומרת LowProfileCode+checkoutUrl, עוברת ל-pending.
 * 8. מחזירה רק orderId/checkoutUrl/accessToken/status - לא entitlement, לא פרטי Cardcom גולמיים.
 */
async function handleCreatePaymentOrder(
  supabase: SupabaseClient,
  reportId: string,
  productType: ProductType,
  idempotencyKey: string
): Promise<{ status: number; body: unknown }> {
  // בדיקת קיום דוח + (עבור cashFlowAnalysis בלבד) תאימות זמנית מול baseReport ישן - ר' תיעוד למטה.
  const { data: reportRow, error: reportError } = await supabase
    .from("dohefes_reports")
    .select("id, payment_status")
    .eq("id", reportId)
    .maybeSingle();

  if (reportError) {
    return { status: 500, body: { error: "internal_error" } };
  }

  // הודעה זהה בין "הדוח לא קיים" לבין "קיים אך baseReport לא שולם" - לא חושפים קיום/אי-קיום
  // דוח מעבר לנדרש (ר' דרישה מפורשת). caller לגיטימי (ה-UI שלנו) כבר יודע ש-reportId אמיתי,
  // כי הוא הגיע אליו דרך ניווט בתוך דוח קיים - לא צריך אישור נוסף פה.
  const NOT_ELIGIBLE = { status: 403, body: { error: "report_not_eligible" } };
  if (!reportRow) return NOT_ELIGIBLE;

  if (productType === "cashFlowAnalysis") {
    // **תאימות זמנית מול המודל הישן** - עד ש-baseReport עצמו עובר ל-product_entitlements
    // (GEN2_PAYMENT_ENTITLEMENT_DESIGN.md §6.2 שלב 4), הבדיקה כאן אחוזה ב-dohefes_reports.payment_status
    // הקיים, לא ב-entitlements. להסיר/להחליף כשה-rollout מגיע לשלב הזה - לא לפני.
    if (reportRow.payment_status !== "paid") return NOT_ELIGIBLE;
  }

  // --- idempotency: מחפשים הזמנה קיימת לפי idempotency_key לפני שיוצרים חדשה ---
  const { data: existingOrder, error: existingError } = await supabase
    .from("dohefes_payment_orders")
    .select("id, status, report_id, product_type, provider_order_reference, cardcom_low_profile_code, checkout_url")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle<OrderRow>();

  if (existingError) {
    return { status: 500, body: { error: "internal_error" } };
  }

  if (existingOrder) {
    // idempotency-key כבר שימש בעבר - **אף פעם לא יוצרים order נוסף**, גם אם reportId/productType
    // בבקשה הנוכחית שונים (מטופל כטעות קלט - אותו idempotency-key חייב להיות עקבי, לא מוחלף בשקט).
    if (existingOrder.report_id !== reportId || existingOrder.product_type !== productType) {
      return { status: 409, body: { error: "idempotency_key_conflict" } };
    }

    if (existingOrder.status === "paid") {
      // "אין לסובב token ואין להחזיר token חדש בלי הוכחת גישה עתידית. החזר סטטוס כללי בלבד."
      return { status: 200, body: { status: "paid" } };
    }

    if (existingOrder.status === "created" || existingOrder.status === "pending") {
      // מותר לסובב token חדש - מטפל במקרה שהתשובה הקודמת אבדה (הדפדפן נסגר/timeout) לפני
      // שהמשתמש הגיע ל-redirect בפועל, בלי לשכפל את ההזמנה.
      return await rotateTokenAndEnsureCheckout(supabase, existingOrder, productType);
    }

    // failed/cancelled/refunded - מצב סופי, לא retryable אוטומטית תחת אותו idempotency-key.
    // מחזירים סטטוס כללי בלבד, בלי token/checkoutUrl חדשים - קריאה חדשה (idempotency-key חדש)
    // נדרשת כדי לנסות שוב.
    return { status: 200, body: { status: existingOrder.status } };
  }

  // --- אין הזמנה קיימת לאותו idempotency-key - יוצרים חדשה ---
  const product = getProduct(productType);
  const providerOrderReference = generateProviderOrderReference();
  const rawToken = generateAccessToken();
  const accessTokenHash = await hashAccessToken(rawToken);

  const { data: insertedOrder, error: insertError } = await supabase
    .from("dohefes_payment_orders")
    .insert({
      report_id: reportId,
      product_type: productType,
      expected_amount_agorot: product.amountAgorot,
      currency_code: product.currencyCode,
      status: "created",
      idempotency_key: idempotencyKey,
      provider_order_reference: providerOrderReference,
      access_token_hash: accessTokenHash,
    })
    .select("id, status, report_id, product_type, provider_order_reference, cardcom_low_profile_code, checkout_url")
    .single<OrderRow>();

  if (insertError || !insertedOrder) {
    return { status: 500, body: { error: "internal_error" } };
  }

  const cardcomOutcome = await callCardcomAndAdvance(supabase, insertedOrder, product.amountAgorot, product.currencyCode, providerOrderReference);
  if (!cardcomOutcome.ok) {
    return { status: 502, body: { error: "payment_provider_error" } };
  }

  return {
    status: 200,
    body: {
      orderId: insertedOrder.id,
      checkoutUrl: cardcomOutcome.checkoutUrl,
      accessToken: rawToken,
      status: "pending",
    },
  };
}

/** retry על הזמנה created/pending: מסובבת token, ומוודאת ש-Cardcom כבר נוצר (קוראת ל-Cardcom
 *  רק אם עדיין לא - checkout_url כבר קיים = לא קוראים שוב, רק מחזירים את מה שכבר יש). */
async function rotateTokenAndEnsureCheckout(
  supabase: SupabaseClient,
  order: OrderRow,
  productType: ProductType
): Promise<{ status: number; body: unknown }> {
  const rawToken = generateAccessToken();
  const accessTokenHash = await hashAccessToken(rawToken);

  const { error: updateError } = await supabase
    .from("dohefes_payment_orders")
    .update({ access_token_hash: accessTokenHash })
    .eq("id", order.id);

  if (updateError) {
    return { status: 500, body: { error: "internal_error" } };
  }

  if (order.status === "pending" && order.checkout_url) {
    // כבר נוצר session אצל Cardcom בעבר - מחזירים את אותו קישור, לא יוצרים שני.
    return {
      status: 200,
      body: { orderId: order.id, checkoutUrl: order.checkout_url, accessToken: rawToken, status: "pending" },
    };
  }

  // status==="created" (מעולם לא הגענו ל-Cardcom), או "pending" בלי checkout_url שמור (לא אמור
  // לקרות במצב תקין - הגנה נוספת בלבד): מנסים ליצור אצל Cardcom עכשיו.
  const product = getProduct(productType);
  const cardcomOutcome = await callCardcomAndAdvance(
    supabase,
    order,
    product.amountAgorot,
    product.currencyCode,
    order.provider_order_reference
  );
  if (!cardcomOutcome.ok) {
    return { status: 502, body: { error: "payment_provider_error" } };
  }

  return {
    status: 200,
    body: { orderId: order.id, checkoutUrl: cardcomOutcome.checkoutUrl, accessToken: rawToken, status: "pending" },
  };
}

/** קוראת ל-Cardcom ליצירת LowProfile, ומעדכנת את ההזמנה בהתאם - pending+פרטי Cardcom בהצלחה,
 *  failed+failure_code כללי בכישלון. **אף פעם לא מסמנת paid כאן** - זו רק "נוצר דף תשלום". */
async function callCardcomAndAdvance(
  supabase: SupabaseClient,
  order: OrderRow,
  amountAgorot: number,
  currencyCode: number,
  providerOrderReference: string
): Promise<{ ok: true; checkoutUrl: string } | { ok: false }> {
  const outcome = await createLowProfile(
    { terminalNumber: CARDCOM_TERMINAL_NUMBER, apiUsername: CARDCOM_API_USERNAME, apiPassword: CARDCOM_API_PASSWORD },
    {
      amountAgorot,
      currencyCode,
      returnValue: providerOrderReference,
      successRedirectUrl: CARDCOM_SUCCESS_URL,
      failedRedirectUrl: CARDCOM_ERROR_URL,
      indicatorUrl: CARDCOM_INDICATOR_URL,
    }
  );

  if (!outcome.ok) {
    await supabase.from("dohefes_payment_orders").update({ status: "failed", failure_code: outcome.failureCode }).eq("id", order.id);
    return { ok: false };
  }

  await supabase
    .from("dohefes_payment_orders")
    .update({
      status: "pending",
      cardcom_low_profile_code: outcome.result.lowProfileCode,
      checkout_url: outcome.result.checkoutUrl,
    })
    .eq("id", order.id);

  return { ok: true, checkoutUrl: outcome.result.checkoutUrl };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return corsPreflightResponse(origin);
  }

  if (!origin || !isAllowedOrigin(origin, ALLOWED_ORIGINS)) {
    return jsonResponse({ error: "origin_not_allowed" }, 403, origin);
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405, origin);
  }

  const idempotencyKey = req.headers.get("Idempotency-Key");
  if (!isUuid(idempotencyKey)) {
    return jsonResponse({ error: "missing_or_invalid_idempotency_key" }, 400, origin);
  }

  const contentLengthHeader = req.headers.get("Content-Length");
  if (contentLengthHeader && Number(contentLengthHeader) > MAX_REQUEST_BODY_BYTES) {
    return jsonResponse({ error: "body_too_large" }, 413, origin);
  }

  const rawBody = await req.text();
  if (byteLength(rawBody) > MAX_REQUEST_BODY_BYTES) {
    // בדיקה חוזרת על הגודל בפועל, לא רק על Content-Length (שניתן לזייף/להשמיט) - ר' payment-security.ts.
    return jsonResponse({ error: "body_too_large" }, 413, origin);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400, origin);
  }

  const parsed = parseRequestBody(parsedJson);
  if (!parsed.ok) {
    return jsonResponse({ error: parsed.error }, 400, origin);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "internal_error" }, 500, origin);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const result = await handleCreatePaymentOrder(supabase, parsed.body.reportId, parsed.body.productType, idempotencyKey);
  return jsonResponse(result.body, result.status, origin);
});
