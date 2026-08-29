// client ייעודי קטן ל-dohefes-get-tracking-data/dohefes-save-tracking-data - נפרד מ-
// payment-client.ts (Commit 5b): concern שונה (נתוני מעקב, לא order/entitlement), אך משתמש
// באותם עזרים בדיוק (readHttpErrorBody/errorReasonFromBody/isRetryableHttpStatus/
// isNonEmptyString, מיוצאים מ-payment-client.ts) - לא משוכפלים כאן.
//
// **דרך supabase.functions.invoke בדיוק כמו payment-client.ts** - לא fetch גולמי - אימות/
// headers/CORS מטופלים על ידי supabase-js. anon JWT נשלח אוטומטית על ידי supabase-js (אותה
// תשתית קיימת בדיוק, לא מנגנון חדש) - הקובץ הזה לא בונה שום header משל עצמו מלבד X-Access-Token.
//
// **access token נשלח רק ב-X-Access-Token, לעולם לא ב-body/query string** - אותו header
// בדיוק כמו dohefes-get-product-access.
//
// **אין console.log/warn/error בקובץ הזה בכלל** - אותה סיבה כמו payment-client.ts: הדרך
// הבטוחה ביותר להבטיח שאין accessToken בלוגים היא לא לרשום שום דבר.
//
// **timeout/retry**: אין עטיפת timeout ידנית כאן - נשען על אותה מדיניות בדיוק כמו
// payment-client.ts (isRetryableHttpStatus מטפל בכשל רשת/relay - status===null - כ-retryable;
// אין הבדל טכנולוגי בין שתי המשפחות הזו, supabase.functions.invoke בשתיהן). **retry אוטומטי
// לא מיושם בקובץ הזה בכלל** - הקורא (state machine + React, ר' RETRY_LOAD/RETRY_SAVE
// ב-access-state.ts) מחליט מתי לנסות שוב, תמיד כפעולה נפרדת ומפורשת (טעינה/כפתור), לא לולאה
// אוטומטית שעלולה להכפיל בקשות.
//
// **saveTrackingData הוא upsert מלא ואידמפוטנטי** (ר' dohefes_save_tracking_data ב-migrations/
// 20260829081055_dohefes_tracking_data.sql - `on conflict (report_id) do update set entries =
// excluded.entries`) - קריאה חוזרת עם **אותו** מערך entries מדויק מייצרת תמיד את אותה תוצאה
// סופית בדיוק, בלי קשר לכמה פעמים היא קרתה. זה **שונה מהותית** מ-createPaymentOrder
// (שדורש Idempotency-Key כדי להיות בטוח לחזרה - יצירת הזמנה היא פעולה לא-אידמפוטנטית
// מטבעה) - כאן אין סיכון ל"שמירה כפולה" מבחינת תוצאה, ולכן אין סיבה עסקית למנוע retry ידני
// חוזר ונשנה על אותה שמירה בדיוק (ר' tracking-client.test.ts, "אידמפוטנטיות").

import type { FunctionsInvoker } from "./payment-client";
import { errorReasonFromBody, isRetryableHttpStatus, readHttpErrorBody } from "./payment-client";
import type { TrackingItem } from "../tracking/types";

export type GetTrackingDataClientResult =
  | { kind: "active"; entries: readonly TrackingItem[] }
  | { kind: "unavailable" }
  | { kind: "retryable" }
  | { kind: "error"; reason: string };

export async function getTrackingData(invoker: FunctionsInvoker, input: { reportId: string; accessToken: string }): Promise<GetTrackingDataClientResult> {
  const { data, error } = await invoker.invoke<{ status?: string; entries?: unknown }>("dohefes-get-tracking-data", {
    headers: { "X-Access-Token": input.accessToken },
    body: { reportId: input.reportId },
  });

  if (error) {
    const { status, body } = await readHttpErrorBody(error);
    if (isRetryableHttpStatus(status)) return { kind: "retryable" };
    return { kind: "error", reason: errorReasonFromBody(body, status === null ? "network_error" : `http_${status}`) };
  }

  if (!data || typeof data.status !== "string") return { kind: "error", reason: "invalid_response_shape" };

  if (data.status === "active") {
    // "נכשל סגור" ברמת המבנה - לא רק typeof status. אם entries חסר/לא מערך, זו תשובה
    // לא-תקינה, לא "active עם 0 פריטים" מנוחש.
    if (!Array.isArray(data.entries)) return { kind: "error", reason: "invalid_response_shape" };
    return { kind: "active", entries: data.entries as TrackingItem[] };
  }

  if (data.status === "unavailable") return { kind: "unavailable" };
  return { kind: "error", reason: "invalid_response_shape" };
}

export type SaveTrackingDataClientResult =
  | { kind: "saved" }
  | { kind: "unavailable" }
  | { kind: "invalid_payload" }
  | { kind: "retryable" }
  | { kind: "error"; reason: string };

export async function saveTrackingData(
  invoker: FunctionsInvoker,
  input: { reportId: string; accessToken: string; entries: readonly TrackingItem[] }
): Promise<SaveTrackingDataClientResult> {
  const { data, error } = await invoker.invoke<{ status?: string }>("dohefes-save-tracking-data", {
    headers: { "X-Access-Token": input.accessToken },
    body: { reportId: input.reportId, entries: input.entries },
  });

  if (error) {
    const { status, body } = await readHttpErrorBody(error);
    if (isRetryableHttpStatus(status)) return { kind: "retryable" };
    return { kind: "error", reason: errorReasonFromBody(body, status === null ? "network_error" : `http_${status}`) };
  }

  if (!data || typeof data.status !== "string") return { kind: "error", reason: "invalid_response_shape" };
  if (data.status === "saved" || data.status === "unavailable" || data.status === "invalid_payload") {
    return { kind: data.status };
  }
  return { kind: "error", reason: "invalid_response_shape" };
}
