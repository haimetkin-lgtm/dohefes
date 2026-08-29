// Edge Function: קריאת נתוני דוח מעקב (trackingReports) עבור דוח קיים. **לא פרוסה עדיין**
// (Commit 5a - תשתית שרת בלבד, אין deploy) - קוד בלבד, לבדיקה/סקירה.
//
// adapter דק בלבד: כל הלוגיקה חיה ב-_shared/tracking-data-service.ts (נבדקת ב-Vitest עם
// fakes, ר. tracking-data-service.test.ts) - הקובץ הזה רק (א) מטפל בפרוטוקול HTTP (method/CORS/
// גודל body/פענוח JSON/חילוץ הטוקן מה-header) ו-(ב) בונה את התלויות האמיתיות (Supabase, Web
// Crypto) ומזריק אותן ל-getTrackingData.
//
// נקראת מהדפדפן (כמו dohefes-get-product-access) - **צריכה CORS**.
//
// חתימה: POST בלבד. גוף: { reportId: string (uuid) }. הטוקן הגולמי מגיע ב-header ייעודי
// (X-Access-Token), **לא** בגוף הבקשה ולא ב-query string - אותה סיבה בדיוק כמו
// dohefes-get-product-access (סוד שלא נוטה להישאר בלוגים חיצוניים כמו headers כן נוטה).
//
// **תגובה אחידה בכוונה**: { status: "active", entries: [...] } | { status: "unavailable" } -
// שום דבר אחר. אותה תגובה בדיוק (unavailable) לדוח לא קיים, טוקן שגוי, entitlement לא-פעילה,
// או דוח לא-תואם לטוקן - אי אפשר להבחין ביניהם מבחוץ. **לעולם לא מוחזר**: access_token_hash,
// מזהה הזמנה/entitlement, פרטי Cardcom, PII.
//
// **קריאה בלבד** - אין UPDATE/INSERT/DELETE בקובץ הזה או ב-_shared/tracking-data-service.ts,
// בשום מקרה. הגישה היחידה למסד הנתונים היא RPC יחיד (dohefes_get_tracking_data, ר.
// migrations/20260829081055_dohefes_tracking_data.sql) עם service_role, אחרי שה-RPC עצמו כבר
// אימת token+entitlement.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { corsPreflightResponse, jsonResponse } from "../_shared/cors.ts";
import { isUuid, hashAccessToken, parseAllowedOrigins, isAllowedOrigin, MAX_REQUEST_BODY_BYTES, byteLength } from "../_shared/payment-security.ts";
import { getTrackingData } from "../_shared/tracking-data-service.ts";
import type { GetTrackingDataResult, RawTrackingGetOutcome, TrackingReadDatabase } from "../_shared/tracking-data-service.ts";

// --- Secrets: שמות בלבד, אין ערכים בקוד. ---
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DOHEFES_ALLOWED_ORIGINS = parseAllowedOrigins(Deno.env.get("DOHEFES_ALLOWED_ORIGINS"));

const ALLOWED_REQUEST_HEADERS = "Content-Type, X-Access-Token";

interface RequestBody {
  reportId: string;
}

/** דוחה במפורש שדות עודפים (productType/accessToken בגוף וכו') - לא רק מתעלמת מהם - שדה עודף
 *  = קלט לא-תקין, לא ניחוש כוונה. productType לא נשלח בכלל - המוצר הוא תמיד trackingReports
 *  (נקבע בשרת, ר. ה-RPC), לא פרמטר מהלקוח. */
function parseRequestBody(raw: unknown): { ok: true; body: RequestBody } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "invalid_body" };
  const record = raw as Record<string, unknown>;

  const allowedKeys = new Set(["reportId"]);
  const extraKeys = Object.keys(record).filter((key) => !allowedKeys.has(key));
  if (extraKeys.length > 0) return { ok: false, error: "unexpected_fields" };

  if (!isUuid(record.reportId)) return { ok: false, error: "invalid_report_id" };

  return { ok: true, body: { reportId: record.reportId } };
}

/** צורת השורה הגולמית שחוזרת בפועל מ-Postgres (snake_case, כמו ה-RPC מגדיר אותה) - **לא**
 *  RawTrackingGetOutcome (camelCase) ישירות. supabase-js לא ממפה אוטומטית בין המוסכמות - מיפוי
 *  מפורש כאן, אותו דפוס בדיוק כמו mapOrderRow ב-dohefes-create-payment-order/index.ts. */
type TrackingDataRpcRow = {
  outcome: RawTrackingGetOutcome["outcome"];
  project_name: string | null;
  entries: RawTrackingGetOutcome["entries"];
};

function mapTrackingDataRow(row: TrackingDataRpcRow): RawTrackingGetOutcome {
  return { outcome: row.outcome, projectName: row.project_name, entries: row.entries };
}

function buildDatabase(supabase: SupabaseClient): TrackingReadDatabase {
  return {
    async getTrackingData(reportId, accessTokenHash) {
      const { data, error } = await supabase
        .rpc("dohefes_get_tracking_data", { p_report_id: reportId, p_access_token_hash: accessTokenHash })
        .single<TrackingDataRpcRow>();
      if (error) throw error;
      return mapTrackingDataRow(data);
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
    const result: GetTrackingDataResult = await getTrackingData(
      { database: buildDatabase(supabase), tokenHasher: { hashAccessToken } },
      { reportId: parsed.body.reportId, rawAccessToken }
    );
    return jsonResponse(result, 200, origin, DOHEFES_ALLOWED_ORIGINS);
  } catch {
    // תקלת DB/רשת בלתי-צפויה - לא חושפים פרטים פנימיים ללקוח, ולא מחזירים "unavailable" (שהוא
    // תשובה תקנית ל"אין גישה", לא ל"קרתה תקלה") - 500 גנרי, כמו שאר ה-Functions.
    return jsonResponse({ error: "internal_error" }, 500, origin, DOHEFES_ALLOWED_ORIGINS);
  }
});
