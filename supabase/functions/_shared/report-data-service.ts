// שכבת orchestration טהורה ל-dohefes-get-report-data/dohefes-save-report-data - Commit 6a. אותו
// דפוס בדיוק כמו _shared/tracking-data-service.ts (Commit 5a/5b-fix): כל תלות חיצונית (מסד
// נתונים, חישוב hash) מוזרקת דרך *ServiceDeps, לא נקראת ישירות. מאפשר בדיקת ה-orchestration
// המלאה דרך Vitest עם fakes, בלי Deno runtime בכלל - ר. report-data-service.test.ts. index.ts
// של כל Function הוא ה-adapter הדק היחיד שמזריק את המימושים האמיתיים (Supabase RPC, Web Crypto).
//
// **גישה אך ורק דרך RPCs אטומיים** (dohefes_get_report_data/dohefes_save_report_data, ר.
// migrations/20260829151144_dohefes_base_report_secure_backend.sql) - שום SELECT/UPDATE ישיר על
// dohefes_reports מכאן. אימות token+entitlement (productType='baseReport') וקריאת/כתיבת הנתונים
// קורים **בתוך אותה קריאת RPC אחת** - לא דפוס "בדוק ואז פעל" נפרד שחשוף למרוץ מול revoke.
//
// **הקלט מהלקוח**: reportId, טוקן גולמי, ו(לשמירה בלבד) projectName/dealType/inputs/results -
// שום דבר אחר. הלקוח **לעולם לא** שולח/צריך לשלוח סטטוס entitlement/payment_status - זה נגזר
// כאן, בצד שרת, מהטוקן בלבד. id/created_at/tracking אינם ניתנים לשינוי דרך הממשק הזה בכלל -
// אין להם פרמטר מקביל בשום מקום בקובץ הזה.

import { validateReportDataPayload } from "./report-data-validator.ts";

export type ReportAccessStatus = "active" | "unavailable";
export type ReportSaveStatus = "saved" | "unavailable" | "invalid_payload";

export interface GetReportDataRequest {
  reportId: string;
  rawAccessToken: string;
}

export interface GetReportDataResult {
  status: ReportAccessStatus;
  reportId?: string;
  projectName?: string | null;
  dealType?: string;
  /** unknown בכוונה (כמו TrackingItem לא מומצא כאן) - מבנה inputs/results הוא של מנוע החישוב
   *  (lib/calc/types.ts), לא מומצא/מצומצם מחדש כאן. */
  inputs?: unknown;
  results?: unknown | null;
}

export interface SaveReportDataRequest {
  reportId: string;
  rawAccessToken: string;
  /** unknown בכוונה - עדיין לא אומת, ר' validateReportDataPayload למטה. */
  payload: unknown;
}

export interface SaveReportDataResult {
  status: ReportSaveStatus;
}

/** תוצאת ה-RPC הגולמית, כמו שחוזרת מ-dohefes_get_report_data - 'invalid_input' ממופה גם הוא
 *  ל-unavailable בשכבה הזו (לא אמור לקרות בזרימה תקינה - fail closed, לא exception לא-צפויה). */
export interface RawReportGetOutcome {
  outcome: "invalid_input" | "unavailable" | "active";
  reportId: string | null;
  projectName: string | null;
  dealType: string | null;
  inputs: unknown | null;
  results: unknown | null;
}

export interface RawReportSaveOutcome {
  outcome: "invalid_input" | "invalid_payload" | "unavailable" | "saved";
}

export interface ReportReadDatabase {
  getReportData(reportId: string, accessTokenHash: string): Promise<RawReportGetOutcome>;
}

export interface ReportWriteDatabase {
  saveReportData(
    reportId: string,
    accessTokenHash: string,
    projectName: string | null,
    dealType: string,
    inputs: unknown,
    results: unknown | null
  ): Promise<RawReportSaveOutcome>;
}

export interface TokenHasher {
  hashAccessToken(rawToken: string): Promise<string>;
}

export interface GetReportDataServiceDeps {
  database: ReportReadDatabase;
  tokenHasher: TokenHasher;
}

export interface SaveReportDataServiceDeps {
  database: ReportWriteDatabase;
  tokenHasher: TokenHasher;
}

const UNAVAILABLE_GET: GetReportDataResult = { status: "unavailable" };
const UNAVAILABLE_SAVE: SaveReportDataResult = { status: "unavailable" };
const INVALID_PAYLOAD: SaveReportDataResult = { status: "invalid_payload" };

/**
 * זרימת הקריאה: אותה בדיוק כמו getTrackingData (tracking-data-service.ts) - טוקן ריק -> unavailable
 * מיד בלי לגעת ב-DB; אחרת hash+RPC (מאמת token+reportId+productType='baseReport'+entitlement
 * פעילה **בפעולה אחת**); outcome!=='active' -> unavailable (אותה תגובה, לא מבחינה בין "טוקן
 * שגוי" ל"אין entitlement" ל"דוח לא תואם").
 */
export async function getReportData(deps: GetReportDataServiceDeps, request: GetReportDataRequest): Promise<GetReportDataResult> {
  if (!request.rawAccessToken) return UNAVAILABLE_GET;

  const accessTokenHash = await deps.tokenHasher.hashAccessToken(request.rawAccessToken);
  const result = await deps.database.getReportData(request.reportId, accessTokenHash);

  if (result.outcome !== "active") return UNAVAILABLE_GET;
  return {
    status: "active",
    reportId: result.reportId ?? request.reportId,
    projectName: result.projectName,
    dealType: result.dealType ?? undefined,
    inputs: result.inputs,
    results: result.results,
  };
}

/**
 * זרימת הקריאה:
 * 1. טוקן ריק/חסר -> unavailable מיד, בלי ולידציית payload ובלי לגעת ב-DB.
 * 2. ולידציית מבנה מלאה (validateReportDataPayload) **לפני** כל קריאה ל-DB - עצם תקינות ה-JSON
 *    אינה עובדה רגישת-אבטחה, ולכן נבדקת מוקדם ובזול, בלי round-trip מיותר ל-DB על payload
 *    שממילא יידחה.
 * 3. hash את הטוקן, קרא ל-RPC עם השדות המאומתים בלבד (לא ה-value הגולמי שהתקבל) - id/created_at/
 *    payment_status/tracking **אינם** נשלחים כאן בכלל, אין להם פרמטר מקביל.
 * 4. outcome==='saved' -> saved. outcome==='invalid_payload' -> invalid_payload (הגנת-עומק, ה-TS
 *    כבר סינן). כל דבר אחר (כולל invalid_input) -> unavailable.
 */
export async function saveReportData(deps: SaveReportDataServiceDeps, request: SaveReportDataRequest): Promise<SaveReportDataResult> {
  if (!request.rawAccessToken) return UNAVAILABLE_SAVE;

  const validated = validateReportDataPayload(request.payload);
  if (!validated.ok) return INVALID_PAYLOAD;

  const accessTokenHash = await deps.tokenHasher.hashAccessToken(request.rawAccessToken);
  const result = await deps.database.saveReportData(
    request.reportId,
    accessTokenHash,
    validated.payload.projectName,
    validated.payload.dealType,
    validated.payload.inputs,
    validated.payload.results
  );

  if (result.outcome === "saved") return { status: "saved" };
  if (result.outcome === "invalid_payload") return INVALID_PAYLOAD;
  return UNAVAILABLE_SAVE;
}
