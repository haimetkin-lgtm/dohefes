// Edge Function שנייה בתשתית התשלום: webhook מ-Cardcom (IndicatorUrl) שמאמת תשלום בפועל ומפעילה
// entitlement. **לא פרוסה עדיין** (ר' דוח ה-commit) - קוד בלבד, לבדיקה/סקירה.
//
// adapter דק בלבד: כל הלוגיקה חיה ב-_shared/payment-indicator-service.ts (נבדקת ב-Vitest עם
// fakes, ר' payment-indicator-service.test.ts) - הקובץ הזה רק (א) מטפל בפרוטוקול HTTP (method/
// גודל body/חילוץ LowProfileCode) ו-(ב) בונה את התלויות האמיתיות (Supabase, Cardcom) ומזריק
// אותן ל-handleIndicatorCallback.
//
// server-to-server בלבד (Cardcom -> אנחנו) - **בלי CORS** (לא נקרא מדפדפן בכלל). מקבלת GET או
// POST - Cardcom עשויה לשלוח בכל אחת מהשתיים. חילוץ LowProfileCode עצמו (מ-query string ב-GET,
// או מגוף הבקשה ב-POST) הוא הדבר היחיד שנקרא מהבקשה הנכנסת - שום שדה אחר בה לא נקרא, לא נחשב
// מהימן, ולא משפיע על שום החלטה (ר' payment-indicator-service.ts לעיקרון המלא). פענוח case-
// insensitive (ר' _shared/name-to-value.ts) - Cardcom לא מתועדת כמחייבת רישיות אחידה ב-webhook.
//
// כתיבה יחידה מותרת: dohefes_finalize_verified_payment (RPC, ר' supabase/payment-schema.sql).
// אין UPDATE/INSERT ישירים על payment_orders/product_entitlements בקובץ הזה, ולא ב-_shared/
// payment-indicator-service.ts, בשום מקרה.
//
// **לעולם לא נכתב/נרשם כאן**: מספר כרטיס, תוקף כרטיס, שם בעל הכרטיס, ת"ז, טלפון, ה-payload
// הגולמי המלא של תגובת Cardcom, או טוקן כרטיס - רק המזהים ההכרחיים לאימות/ביקורת.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createCardcomClient } from "../_shared/cardcom-client.ts";
import { getField, parseNameToValue } from "../_shared/name-to-value.ts";
import { MAX_REQUEST_BODY_BYTES, byteLength } from "../_shared/payment-security.ts";
import { handleIndicatorCallback } from "../_shared/payment-indicator-service.ts";
import type {
  FinalizeOutcome,
  OrderForVerification,
  PaymentIndicatorDatabase,
  SecurityEventReason,
} from "../_shared/payment-indicator-service.ts";

// --- Secrets: שמות בלבד, אין ערכים בקוד. ---
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CARDCOM_TERMINAL_NUMBER = Deno.env.get("CARDCOM_TERMINAL_NUMBER") ?? "";
const CARDCOM_API_USERNAME = Deno.env.get("CARDCOM_API_USERNAME") ?? "";

type OrderRow = {
  id: string;
  report_id: string;
  product_type: string;
  provider_order_reference: string;
  expected_amount_agorot: number;
  currency_code: number;
};

type RpcRow = {
  outcome: FinalizeOutcome["outcome"];
  order_id: string | null;
  report_id: string | null;
  product_type: string | null;
  entitlement_id: string | null;
};

function buildDatabase(supabase: SupabaseClient): PaymentIndicatorDatabase {
  return {
    async getOrderByLowProfileCode(lowProfileCode: string): Promise<OrderForVerification | null> {
      const { data, error } = await supabase
        .from("dohefes_payment_orders")
        .select("id, report_id, product_type, provider_order_reference, expected_amount_agorot, currency_code")
        .eq("cardcom_low_profile_code", lowProfileCode)
        .maybeSingle<OrderRow>();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        reportId: data.report_id,
        productType: data.product_type,
        providerOrderReference: data.provider_order_reference,
        expectedAmountAgorot: data.expected_amount_agorot,
        currencyCode: data.currency_code,
      };
    },

    async finalizeVerifiedPayment(
      lowProfileCode: string,
      cardcomInternalDealNumber: string,
      verifiedProviderOrderReference: string,
      verifiedAmountAgorot: number,
      verifiedCurrencyCode: number
    ): Promise<FinalizeOutcome> {
      const { data, error } = await supabase
        .rpc("dohefes_finalize_verified_payment", {
          p_low_profile_code: lowProfileCode,
          p_cardcom_internal_deal_number: cardcomInternalDealNumber,
          p_verified_provider_order_reference: verifiedProviderOrderReference,
          p_verified_amount_agorot: verifiedAmountAgorot,
          p_verified_currency_code: verifiedCurrencyCode,
        })
        .single<RpcRow>();
      if (error) throw error;
      return {
        outcome: data.outcome,
        orderId: data.order_id,
        reportId: data.report_id,
        productType: data.product_type,
        entitlementId: data.entitlement_id,
      };
    },

    async recordSecurityEvent(event: { reason: SecurityEventReason; lowProfileCode: string }): Promise<void> {
      // תיעוד מינימלי, בלי PII - רק סיבה כללית + lowProfileCode (מזהה טכני שלנו, לא מידע אישי).
      // אין טבלת audit ייעודית בשלב הזה - console.error בלבד, עד שתיווסף (מחוץ להיקף העבודה הזו).
      console.error("dohefes_cardcom_security_event", { reason: event.reason, lowProfileCode: event.lowProfileCode });
    },
  };
}

/** חילוץ LowProfileCode בלבד מהבקשה הנכנסת - זה השדה היחיד שנקרא ממנה. GET: query string.
 *  POST: גוף הבקשה (Name-To-Value), עם הגבלת גודל (אותה מגבלה כמו create-payment-order) לפני
 *  שקוראים את הגוף בכלל - הגנה בסיסית מפני payload גדול מדי על נקודת קצה ציבורית וללא אימות. */
async function extractLowProfileCode(req: Request): Promise<{ ok: true; lowProfileCode: string | null } | { ok: false }> {
  const url = new URL(req.url);
  const queryMap = parseNameToValue(url.search.replace(/^\?/, ""));
  const fromQuery = getField(queryMap, "LowProfileCode");
  if (fromQuery) return { ok: true, lowProfileCode: fromQuery };

  if (req.method === "POST") {
    const contentLengthHeader = req.headers.get("Content-Length");
    if (contentLengthHeader && Number(contentLengthHeader) > MAX_REQUEST_BODY_BYTES) {
      return { ok: false };
    }
    const raw = await req.text();
    if (byteLength(raw) > MAX_REQUEST_BODY_BYTES) {
      return { ok: false };
    }
    const bodyMap = parseNameToValue(raw);
    return { ok: true, lowProfileCode: getField(bodyMap, "LowProfileCode") ?? null };
  }

  return { ok: true, lowProfileCode: null };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response(null, { status: 405 });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(null, { status: 500 });
  }

  const extracted = await extractLowProfileCode(req);
  if (!extracted.ok) {
    return new Response(null, { status: 413 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const cardcomClient = createCardcomClient({ terminalNumber: CARDCOM_TERMINAL_NUMBER, userName: CARDCOM_API_USERNAME });

  try {
    const result = await handleIndicatorCallback({ database: buildDatabase(supabase), cardcomClient }, extracted.lowProfileCode);
    return new Response(null, { status: result.httpStatus });
  } catch {
    // תקלת DB/רשת בלתי-צפויה - 503 (לא 500): מתירה ל-Cardcom לנסות שוב, לא חושפת פרטים פנימיים.
    return new Response(null, { status: 503 });
  }
});
