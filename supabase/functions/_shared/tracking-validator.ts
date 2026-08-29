// ולידציה טהורה לנתוני דוח מעקב (TrackingItem[]) - Commit 5a. משמשת את שתי ה-Edge Functions
// (dohefes-get-tracking-data/dohefes-save-tracking-data) לפני כל קריאה ל-RPC - לא סומכת על
// ה-DB check constraints בלבד (הגנת-עומק, אותו עיקרון כמו שאר הפרויקט: כמה שכבות בדיקה
// עצמאיות, לא כפילות מיותרת - ר' migrations/20260829081055_dohefes_tracking_data.sql).
//
// המבנה תואם בדיוק ל-lib/tracking/types.ts (TrackingItem) - לא ממציא מודל עסקי חדש, רק
// מאמת את מה שה-UI הקיים כבר כותב היום ל-dohefes_reports.tracking (ר' app/tracking/page.tsx,
// updateItem/emptyItem). קובץ טהור, בלי שום ייבוא ספציפי ל-Deno - ניתן לבדיקה ישירה מ-Vitest.

export interface TrackingItem {
  readonly id: string;
  readonly phase: string;
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceNis: number;
  readonly actualNis: number;
}

const TRACKING_ITEM_KEYS: ReadonlySet<string> = new Set(["id", "phase", "description", "quantity", "unitPriceNis", "actualNis"]);

/**
 * 200,000 בתים - נדיב בהרבה מ-MAX_REQUEST_BODY_BYTES (4,096, payment-security.ts) בכוונה:
 * payload כאן הוא מערך פריטים אמיתי (עשרות/מאות שורות תקציב עם טקסט עברי חופשי), לא
 * reportId+productType. **אותו ערך בדיוק** חוזר כ-check constraint
 * (dohefes_tracking_data_entries_not_too_large) במיגרציה - אין דרך טכנית לשתף קבוע ממשי בין
 * TS ל-SQL, מתועד כאן ושם במפורש כדי שלא יסטו זה מזה בעתיד.
 */
export const MAX_TRACKING_BODY_BYTES = 200_000;

/**
 * 1000 - הגנה נוספת, בלתי-תלויה בגודל בבתים (הרבה שורות קצרות עדיין עלולות להעמיס). נדיב
 * בהרבה מפרויקט אמיתי (עשרות עד מאות שורות תקציב טיפוסי). **אותו ערך בדיוק** חוזר כ-check
 * constraint (dohefes_tracking_data_entries_not_too_many) במיגרציה.
 */
export const MAX_TRACKING_ITEMS = 1000;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** לא בודקת "תקין עסקית" (כמות שלילית וכו') - רק בטיחות טכנית (מספר סופי) ומבנה (מפתחות
 *  סגורים). אין הוספת דרישות עסקיות חדשות שלא ביקש ה-UI הקיים - "אל תשנה את המודל המקצועי". */
function isValidItem(value: unknown): value is TrackingItem {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;

  const keys = Object.keys(record);
  if (keys.length !== TRACKING_ITEM_KEYS.size) return false;
  for (const key of keys) {
    if (!TRACKING_ITEM_KEYS.has(key)) return false;
  }

  if (typeof record.id !== "string" || record.id.length === 0) return false;
  if (typeof record.phase !== "string") return false;
  if (typeof record.description !== "string") return false;
  if (!isFiniteNumber(record.quantity)) return false;
  if (!isFiniteNumber(record.unitPriceNis)) return false;
  if (!isFiniteNumber(record.actualNis)) return false;

  return true;
}

export type ValidateTrackingPayloadResult =
  | { ok: true; items: readonly TrackingItem[] }
  | { ok: false; error: "not_array" | "too_many_items" | "invalid_item" };

/**
 * טהורה לחלוטין - לא נוגעת ב-value המקורי בשום צורה (לא sort/normalize/מוסיפה שדות/מוחקת
 * שדות) - רק קוראת ומחזירה readonly view על אותו array (או שגיאה). מערך ריק (`[]`) הוא payload
 * חוקי לגמרי - "כלי ריק נשמר בצורה מפורשת ועקבית, לא כ-payload מקרי" (הלולאה פשוט לא רצה,
 * מוחזר ok:true עם items:[]).
 *
 * גודל בבתים של ה-body הגולמי (MAX_TRACKING_BODY_BYTES) נבדק **לפני** קריאה לפונקציה הזו,
 * ברמת ה-body הגולמי (מחרוזת) ב-index.ts של כל Function - לא כאן, כי בשלב הזה כבר עברנו
 * JSON.parse ואין עוד גישה למספר הבתים המקורי של הטקסט.
 */
export function validateTrackingPayload(value: unknown): ValidateTrackingPayloadResult {
  if (!Array.isArray(value)) return { ok: false, error: "not_array" };
  if (value.length > MAX_TRACKING_ITEMS) return { ok: false, error: "too_many_items" };
  for (const item of value) {
    if (!isValidItem(item)) return { ok: false, error: "invalid_item" };
  }
  return { ok: true, items: value as readonly TrackingItem[] };
}
