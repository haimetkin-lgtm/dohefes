// Edge Function: שמירת נתוני דוח מעקב (trackingReports) עבור דוח קיים. **לא פרוסה עדיין**
// (Commit 5a - תשתית שרת בלבד, אין deploy) - קוד בלבד, לבדיקה/סקירה.
//
// adapter דק בלבד: כל הלוגיקה חיה ב-_shared/tracking-data-service.ts (נבדקת ב-Vitest עם
// fakes, ר. tracking-data-service.test.ts) - הקובץ הזה רק (א) מטפל בפרוטוקול HTTP (method/CORS/
// גודל body/פענוח JSON/חילוץ הטוקן מה-header) ו-(ב) בונה את התלויות האמיתיות ומזריק אותן
// ל-saveTrackingData.
//
// נקראת מהדפדפן - **צריכה CORS**.
//
// חתימה: POST בלבד. גוף: { reportId: string (uuid), entries: unknown[] }. הטוקן הגולמי מגיע
// ב-header ייעודי (X-Access-Token), אותה סיבה כמו dohefes-get-tracking-data.
//
// **גודל body מוגבל ל-MAX_TRACKING_BODY_BYTES (200KB, לא MAX_REQUEST_BODY_BYTES 4KB)** -
// payload כאן הוא מערך פריטי תקציב אמיתי, לא reportId+productType בלבד - ר.
// _shared/tracking-validator.ts.
//
// **ולידציית מבנה מלאה** על entries דרך validateTrackingPayload (בתוך tracking-data-service.ts)
// **לפני** כל קריאה ל-DB - מפתחות סגורים, מספרים סופיים בלבד, בלי NaN/Infinity, בלי מוטציה
// של הקלט. הפונקציה הזו עצמה **לא** מבצעת שום ולידציה עסקית נוספת מעבר לזה.
//
// **תגובה אחידה בכוונה**: { status: "saved" } | { status: "unavailable" } |
// { status: "invalid_payload" } - שום דבר אחר. "unavailable" זהה לכל סיבות חוסר-הגישה (טוקן
// שגוי/entitlement לא-פעילה/דוח לא-תואם) - אי אפשר להבחין ביניהן מבחוץ. **לעולם לא מוחזר**:
// access_token_hash, מזהה הזמנה/entitlement, פרטי Cardcom, PII.
//
// **הגישה היחידה למסד הנתונים היא RPC יחיד** (dohefes_save_tracking_data, ר.
// migrations/20260829081055_dohefes_tracking_data.sql) עם service_role, שמאמת token+entitlement
// וכותב באותה פעולה אטומית - אין SELECT/UPDATE/UPSERT ישיר על dohefes_tracking_data מכאן, ואין
// שום נגיעה ב-dohefes_reports בכלל (לא UPDATE, לא SELECT) - "נתוני דוח בסיס אינם ניתנים לשינוי
// דרך Function המעקב".
//
// **אינה פונה ל-Cardcom בשום צורה** - אין שם ספק תשלום בקובץ הזה בכלל.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { corsPreflightResponse, jsonResponse } from "../_shared/cors.ts";
import { isUuid, hashAccessToken, parseAllowedOrigins, isAllowedOrigin, byteLength } from "../_shared/payment-security.ts";
import { MAX_TRACKING_BODY_BYTES } from "../_shared/tracking-validator.ts";
import { saveTrackingData } from "../_shared/tracking-data-service.ts";
import type { RawTrackingSaveOutcome, SaveTrackingDataResult, TrackingWriteDatabase } from "../_shared/tracking-data-service.ts";

// --- Secrets: שמות בלבד, אין ערכים בקוד. ---
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DOHEFES_ALLOWED_ORIGINS = parseAllowedOrigins(Deno.env.get("DOHEFES_ALLOWED_ORIGINS"));

const ALLOWED_REQUEST_HEADERS = "Content-Type, X-Access-Token";

interface RequestBody {
  reportId: string;
  entries: unknown;
}

/** דוחה במפורש שדות עודפים - productType לא נשלח (תמיד trackingReports, נקבע בשרת). entries
 *  עצמו נשאר unknown כאן במכוון - ולידציית המבנה המלאה קורית ב-tracking-data-service.ts
 *  (validateTrackingPayload), לא כאן - לא לשכפל את הלוגיקה בשתי שכבות. */
function parseRequestBody(raw: unknown): { ok: true; body: RequestBody } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "invalid_body" };
  const record = raw as Record<string, unknown>;

  const allowedKeys = new Set(["reportId", "entries"]);
  const extraKeys = Object.keys(record).filter((key) => !allowedKeys.has(key));
  if (extraKeys.length > 0) return { ok: false, error: "unexpected_fields" };

  if (!isUuid(record.reportId)) return { ok: false, error: "invalid_report_id" };
  if (!("entries" in record)) return { ok: false, error: "missing_entries" };

  return { ok: true, body: { reportId: record.reportId, entries: record.entries } };
}

function buildDatabase(supabase: SupabaseClient): TrackingWriteDatabase {
  return {
    async saveTrackingData(reportId, accessTokenHash, entries) {
      const { data, error } = await supabase
        .rpc("dohefes_save_tracking_data", { p_report_id: reportId, p_access_token_hash: accessTokenHash, p_entries: entries })
        .single<RawTrackingSaveOutcome>();
      if (error) throw error;
      return data;
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
  if (contentLengthHeader && Number(contentLengthHeader) > MAX_TRACKING_BODY_BYTES) {
    return jsonResponse({ error: "body_too_large" }, 413, origin, DOHEFES_ALLOWED_ORIGINS);
  }

  const rawBody = await req.text();
  if (byteLength(rawBody) > MAX_TRACKING_BODY_BYTES) {
    // בדיקה חוזרת על הגודל בפועל, לא רק על Content-Length (שניתן לזייף/להשמיט).
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
    const result: SaveTrackingDataResult = await saveTrackingData(
      { database: buildDatabase(supabase), tokenHasher: { hashAccessToken } },
      { reportId: parsed.body.reportId, rawAccessToken, entries: parsed.body.entries }
    );
    return jsonResponse(result, 200, origin, DOHEFES_ALLOWED_ORIGINS);
  } catch {
    // תקלת DB/רשת בלתי-צפויה - לא חושפים פרטים פנימיים ללקוח.
    return jsonResponse({ error: "internal_error" }, 500, origin, DOHEFES_ALLOWED_ORIGINS);
  }
});
