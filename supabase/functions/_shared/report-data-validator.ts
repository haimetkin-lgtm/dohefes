// ולידציה טהורה לגוף dohefes-save-report-data - Commit 6a. לא מכפילה את מנוע החישוב
// (lib/calc/engine.ts) או את מבנה CostInputs/UnitType המלא (lib/calc/types.ts) - inputs/results
// נשארים jsonb "אטום" מבחינת הקובץ הזה, בדיוק כמו שה-autosave הקיים ב-app/calculator/page.tsx
// כותב אותם היום. הבדיקות כאן הן בטיחות טכנית בלבד: מבנה גס (אובייקט, לא מערך/null/פרימיטיב),
// גודל payload סביר, ואין ערכים מספריים לא-סופיים (NaN/Infinity) בשום עומק - לא ולידציה עסקית.
//
// dealType מאומת מול deal-types.ts (isDealType) - **מותר לשינוי** דרך הפונקציה הזו: ה-UI הקיים
// (app/calculator/page.tsx, effect שני - "שמירה רציפה") כבר כותב deal_type בכל autosave, לא רק
// בשמירה הראשונה - זה משקף התנהגות קיימת בפועל (בורר סוג העסקה נשאר פעיל בטופס אחרי יצירת
// הדוח), לא הרחבה חדשה של המודל העסקי.
//
// קובץ טהור, בלי שום ייבוא ספציפי ל-Deno - ניתן לבדיקה ישירה מ-Vitest, ר. report-data-validator.test.ts.

import { isDealType } from "./deal-types.ts";

/**
 * 500,000 בתים - נדיב בהרבה מ-MAX_TRACKING_BODY_BYTES (200,000, tracking-validator.ts) בכוונה:
 * דוח כדאיות כולל מערך יחידות (units) פוטנציאלית ארוך + פירוט עלויות/תוצאות מלא, מבנה עשיר
 * יותר ממערך סעיפי תקציב שטוח. **אותו ערך בדיוק** חוזר כבדיקה מפורשת בתוך
 * migrations/20260829151144_dohefes_base_report_secure_backend.sql (dohefes_save_report_data)
 * - אין דרך טכנית לשתף קבוע ממשי בין TS ל-SQL, מתועד כאן ושם במפורש כדי שלא יסטו.
 */
export const MAX_REPORT_DATA_BODY_BYTES = 500_000;

/** אורך שם פרויקט סביר - הגנה טכנית גרידא, לא דרישה עסקית (אין מגבלת אורך קיימת ב-UI היום). */
export const MAX_PROJECT_NAME_LENGTH = 300;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * סריקה רקורסיבית: דוחה כל מספר לא-סופי (NaN/Infinity/-Infinity) בכל עומק בתוך value - הגנת-
 * עומק בלבד. JSON.parse עצמו לא יכול לייצר NaN/Infinity (אינם token-ים חוקיים ב-JSON) - הבדיקה
 * הזו רלוונטית בעיקר אם ערך יגיע אי-פעם דרך נתיב שאינו JSON.parse רגיל (למשל קריאה ישירה
 * מ-TypeScript בבדיקות), בדיוק כמו isFiniteNumber ב-tracking-validator.ts.
 */
function hasNonFiniteNumber(value: unknown): boolean {
  if (typeof value === "number") return !Number.isFinite(value);
  if (Array.isArray(value)) return value.some(hasNonFiniteNumber);
  if (isPlainObject(value)) return Object.values(value).some(hasNonFiniteNumber);
  return false;
}

export interface ReportDataPayload {
  readonly projectName: string | null;
  readonly dealType: string;
  readonly inputs: Record<string, unknown>;
  readonly results: Record<string, unknown> | null;
}

export type ValidateReportDataPayloadResult =
  | { ok: true; payload: ReportDataPayload }
  | { ok: false; error: "invalid_project_name" | "invalid_deal_type" | "invalid_inputs" | "invalid_results" | "too_large" | "non_finite_number" };

/**
 * טהורה לחלוטין - לא נוגעת ב-value המקורי בשום צורה (לא sort/normalize/מוסיפה שדות/מוחקת
 * שדות). גודל ה-body הגולמי (MAX_REPORT_DATA_BODY_BYTES) נבדק **גם** ברמת המחרוזת הגולמית
 * ב-index.ts (לפני JSON.parse, אותו דפוס כמו dohefes-save-tracking-data), **וגם** כאן ברמת
 * inputs/results בנפרד לאחר הפענוח - הגנת-עומק כפולה, לא כפילות מיותרת: בדיקת ה-body הגולמי
 * חוסמת payload ענק לפני שמפענחים אותו בכלל; הבדיקה כאן חוסמת מקרה שבו inputs/results בודדים
 * חורגים גם כש-body הכולל (למשל עם projectName ארוך) עדיין מתחת לתקרה.
 */
export function validateReportDataPayload(value: unknown): ValidateReportDataPayloadResult {
  if (!isPlainObject(value)) return { ok: false, error: "invalid_inputs" };

  const { projectName, dealType, inputs, results } = value as Record<string, unknown>;

  if (projectName !== null && projectName !== undefined) {
    if (typeof projectName !== "string" || projectName.length > MAX_PROJECT_NAME_LENGTH) {
      return { ok: false, error: "invalid_project_name" };
    }
  }

  if (!isDealType(dealType)) return { ok: false, error: "invalid_deal_type" };

  if (!isPlainObject(inputs)) return { ok: false, error: "invalid_inputs" };
  if (octetLength(JSON.stringify(inputs)) > MAX_REPORT_DATA_BODY_BYTES) return { ok: false, error: "too_large" };
  if (hasNonFiniteNumber(inputs)) return { ok: false, error: "non_finite_number" };

  let normalizedResults: Record<string, unknown> | null = null;
  if (results !== null && results !== undefined) {
    if (!isPlainObject(results)) return { ok: false, error: "invalid_results" };
    if (octetLength(JSON.stringify(results)) > MAX_REPORT_DATA_BODY_BYTES) return { ok: false, error: "too_large" };
    if (hasNonFiniteNumber(results)) return { ok: false, error: "non_finite_number" };
    normalizedResults = results;
  }

  return {
    ok: true,
    payload: { projectName: (projectName as string | undefined) ?? null, dealType, inputs, results: normalizedResults },
  };
}

function octetLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
