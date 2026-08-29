// Edge Function: שמירת נתוני דוח (baseReport) עבור דוח קיים. **לא פרוסה עדיין** (Commit 6a -
// תשתית שרת בלבד, אין deploy) - קוד בלבד, לבדיקה/סקירה.
//
// adapter דק בלבד: כל הלוגיקה חיה ב-_shared/report-data-service.ts (נבדקת ב-Vitest עם fakes,
// ר. report-data-service.test.ts) - הקובץ הזה רק (א) מטפל בפרוטוקול HTTP (method/CORS/גודל
// body/פענוח JSON/חילוץ הטוקן מה-header) ו-(ב) בונה את התלויות האמיתיות ומזריק אותן
// ל-saveReportData.
//
// נקראת מהדפדפן - **צריכה CORS**.
//
// חתימה: POST בלבד. גוף: { reportId: string (uuid), projectName, dealType, inputs, results }.
// הטוקן הגולמי מגיע ב-header ייעודי (X-Access-Token), אותה סיבה כמו dohefes-get-report-data.
//
// **גודל body מוגבל ל-MAX_REPORT_DATA_BODY_BYTES (500KB) כפול (inputs/results נבדקים בנפרד
// ב-report-data-validator.ts), לא MAX_REQUEST_BODY_BYTES (4KB)** - payload כאן הוא דוח כדאיות
// מלא (יחידות, עלויות, תוצאות), לא reportId+productType בלבד.
//
// **ולידציית מבנה מלאה** דרך validateReportDataPayload (בתוך report-data-service.ts) **לפני**
// כל קריאה ל-DB - dealType מאומת מול רשימה קשיחה, inputs/results נבדקים כאובייקט (לא מערך/
// primitive), בלי NaN/Infinity בשום עומק, בלי מוטציה של הקלט. הפונקציה הזו עצמה **לא** מבצעת
// שום ולידציה עסקית נוספת מעבר לזה - **לא** מכפילה את מנוע החישוב (lib/calc/engine.ts).
//
// **id/payment_status/tracking/created_at אינם ניתנים לשינוי דרך הממשק הזה בכלל** - אין להם
// שדה מקביל בגוף הבקשה, ב-SaveReportDataRequest, או בפרמטרי ה-RPC.
//
// **תגובה אחידה בכוונה**: { status: "saved" } | { status: "unavailable" } |
// { status: "invalid_payload" } - שום דבר אחר. "unavailable" זהה לכל סיבות חוסר-הגישה (טוקן
// שגוי/entitlement לא-פעילה/דוח לא-תואם) - אי אפשר להבחין ביניהן מבחוץ.
//
// **הגישה היחידה למסד הנתונים היא RPC יחיד** (dohefes_save_report_data, ר.
// migrations/20260829151144_dohefes_base_report_secure_backend.sql) עם service_role, שמאמת
// token+entitlement וכותב באותה פעולה אטומית - אין SELECT/UPDATE/UPSERT ישיר על dohefes_reports
// מכאן.
//
// **אינה פונה ל-Cardcom בשום צורה** - אין שם ספק תשלום בקובץ הזה בכלל.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { corsPreflightResponse, jsonResponse } from "../_shared/cors.ts";
import { isUuid, hashAccessToken, parseAllowedOrigins, isAllowedOrigin, byteLength } from "../_shared/payment-security.ts";
import { MAX_REPORT_DATA_BODY_BYTES } from "../_shared/report-data-validator.ts";
import { saveReportData } from "../_shared/report-data-service.ts";
import type { RawReportSaveOutcome, SaveReportDataResult, ReportWriteDatabase } from "../_shared/report-data-service.ts";

// --- Secrets: שמות בלבד, אין ערכים בקוד. ---
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DOHEFES_ALLOWED_ORIGINS = parseAllowedOrigins(Deno.env.get("DOHEFES_ALLOWED_ORIGINS"));

const ALLOWED_REQUEST_HEADERS = "Content-Type, X-Access-Token";

interface RequestBody {
  reportId: string;
  payload: unknown;
}

/** דוחה במפורש שדות עודפים ברמת ה-envelope (reportId+payload בלבד) - productType לא נשלח
 *  (תמיד baseReport, נקבע בשרת). projectName/dealType/inputs/results עצמם נשארים unknown
 *  כאן במכוון - ולידציית המבנה המלאה קורית ב-report-data-service.ts (validateReportDataPayload),
 *  לא כאן - לא לשכפל את הלוגיקה בשתי שכבות. */
function parseRequestBody(raw: unknown): { ok: true; body: RequestBody } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "invalid_body" };
  const record = raw as Record<string, unknown>;

  const allowedKeys = new Set(["reportId", "projectName", "dealType", "inputs", "results"]);
  const extraKeys = Object.keys(record).filter((key) => !allowedKeys.has(key));
  if (extraKeys.length > 0) return { ok: false, error: "unexpected_fields" };

  if (!isUuid(record.reportId)) return { ok: false, error: "invalid_report_id" };

  const payload: Record<string, unknown> = { ...record };
  delete payload.reportId;
  return { ok: true, body: { reportId: record.reportId, payload } };
}

function buildDatabase(supabase: SupabaseClient): ReportWriteDatabase {
  return {
    async saveReportData(reportId, accessTokenHash, projectName, dealType, inputs, results) {
      const { data, error } = await supabase
        .rpc("dohefes_save_report_data", {
          p_report_id: reportId,
          p_access_token_hash: accessTokenHash,
          p_project_name: projectName,
          p_deal_type: dealType,
          p_inputs: inputs,
          p_results: results,
        })
        .single<RawReportSaveOutcome>();
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
  if (contentLengthHeader && Number(contentLengthHeader) > MAX_REPORT_DATA_BODY_BYTES) {
    return jsonResponse({ error: "body_too_large" }, 413, origin, DOHEFES_ALLOWED_ORIGINS);
  }

  const rawBody = await req.text();
  if (byteLength(rawBody) > MAX_REPORT_DATA_BODY_BYTES) {
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
    const result: SaveReportDataResult = await saveReportData(
      { database: buildDatabase(supabase), tokenHasher: { hashAccessToken } },
      { reportId: parsed.body.reportId, rawAccessToken, payload: parsed.body.payload }
    );
    return jsonResponse(result, 200, origin, DOHEFES_ALLOWED_ORIGINS);
  } catch {
    return jsonResponse({ error: "internal_error" }, 500, origin, DOHEFES_ALLOWED_ORIGINS);
  }
});
