// שכבת orchestration טהורה ל-dohefes-get-tracking-data/dohefes-save-tracking-data - כל תלות
// חיצונית (מסד נתונים, חישוב hash) מוזרקת דרך TrackingDataServiceDeps, לא נקראת ישירות.
// מאפשר בדיקת ה-orchestration המלאה דרך Vitest עם fakes, בלי Deno runtime בכלל - ר.
// tracking-data-service.test.ts. index.ts של כל Function הוא ה-adapter הדק היחיד שמזריק את
// המימושים האמיתיים (Supabase RPC, Web Crypto).
//
// **גישה אך ורק דרך RPCs אטומיים** (dohefes_get_tracking_data/dohefes_save_tracking_data,
// ר. migrations/20260829081055_dohefes_tracking_data.sql) - שום SELECT/UPDATE/UPSERT ישיר על
// dohefes_tracking_data מכאן. אימות token+entitlement וקריאת/כתיבת הנתונים קורים **בתוך אותה
// קריאת RPC אחת** - לא דפוס "בדוק ואז פעל" נפרד שחשוף למרוץ מול revoke, ר' ההערה המלאה
// במיגרציה.
//
// **הקלט מהלקוח**: reportId, טוקן גולמי, ו(לשמירה בלבד) מערך הפריטים עצמו - שום דבר אחר.
// הלקוח **לעולם לא** שולח/צריך לשלוח סטטוס entitlement - זה נגזר כאן, בצד שרת, מהטוקן בלבד.

import { validateTrackingPayload } from "./tracking-validator.ts";
import type { TrackingItem } from "./tracking-validator.ts";

export type TrackingAccessStatus = "active" | "unavailable";
export type TrackingSaveStatus = "saved" | "unavailable" | "invalid_payload";

export interface GetTrackingDataRequest {
  reportId: string;
  rawAccessToken: string;
}

export interface GetTrackingDataResult {
  status: TrackingAccessStatus;
  /** תמיד מלא (גם מערך ריק) כש-status==="active" - undefined כש-unavailable, לא [] מטעה. */
  entries?: readonly TrackingItem[];
}

export interface SaveTrackingDataRequest {
  reportId: string;
  rawAccessToken: string;
  /** unknown בכוונה - עדיין לא אומת, ר' validateTrackingPayload למטה. */
  entries: unknown;
}

export interface SaveTrackingDataResult {
  status: TrackingSaveStatus;
}

/** תוצאת ה-RPC הגולמית, כמו שחוזרת מ-dohefes_get_tracking_data - 'invalid_input' ממופה גם הוא
 *  ל-unavailable בשכבה הזו (לא אמור לקרות בזרימה תקינה, ה-Edge Function כבר מאמתת UUID/טוקן
 *  לא-ריק לפני הקריאה - fail closed, לא exception לא-צפויה). */
export interface RawTrackingGetOutcome {
  outcome: "invalid_input" | "unavailable" | "active";
  entries: TrackingItem[] | null;
}

export interface RawTrackingSaveOutcome {
  outcome: "invalid_input" | "invalid_payload" | "unavailable" | "saved";
}

/** קריאה בלבד - אין דרך מבנית לכתוב דרך הממשק הזה, גם אם מישהו ינסה (אותו עיקרון בדיוק כמו
 *  PaymentAccessDatabase ב-_shared/payment-access-service.ts) - dohefes-get-tracking-data
 *  מזריק מימוש שמיישם **רק** את הממשק הזה, לא TrackingDatabase המשולב. */
export interface TrackingReadDatabase {
  getTrackingData(reportId: string, accessTokenHash: string): Promise<RawTrackingGetOutcome>;
}

/** כתיבה בלבד - dohefes-save-tracking-data מזריק מימוש שמיישם רק את הממשק הזה. */
export interface TrackingWriteDatabase {
  saveTrackingData(reportId: string, accessTokenHash: string, entries: readonly TrackingItem[]): Promise<RawTrackingSaveOutcome>;
}

export interface TokenHasher {
  hashAccessToken(rawToken: string): Promise<string>;
}

export interface GetTrackingDataServiceDeps {
  database: TrackingReadDatabase;
  tokenHasher: TokenHasher;
}

export interface SaveTrackingDataServiceDeps {
  database: TrackingWriteDatabase;
  tokenHasher: TokenHasher;
}

const UNAVAILABLE_GET: GetTrackingDataResult = { status: "unavailable" };
const UNAVAILABLE_SAVE: SaveTrackingDataResult = { status: "unavailable" };
const INVALID_PAYLOAD: SaveTrackingDataResult = { status: "invalid_payload" };

/**
 * זרימת הקריאה:
 * 1. טוקן ריק/חסר -> unavailable מיד, בלי לגעת ב-DB בכלל (אותו עיקרון כמו
 *    payment-access-service.ts checkProductAccess).
 * 2. hash את הטוקן, קרא ל-RPC (מאמת token+entitlement+report **בפעולה אחת**).
 * 3. outcome!=='active' -> unavailable (אותה תגובה, לא מבחינה בין "טוקן שגוי" ל"אין entitlement"
 *    ל"דוח לא תואם" - אי אפשר להבחין ביניהם מבחוץ).
 * 4. active -> entries תמיד מוחזר (ברירת מחדל [] אם ה-RPC איכשהו החזיר null - הגנת-עומק).
 */
export async function getTrackingData(deps: GetTrackingDataServiceDeps, request: GetTrackingDataRequest): Promise<GetTrackingDataResult> {
  if (!request.rawAccessToken) return UNAVAILABLE_GET;

  const accessTokenHash = await deps.tokenHasher.hashAccessToken(request.rawAccessToken);
  const result = await deps.database.getTrackingData(request.reportId, accessTokenHash);

  if (result.outcome !== "active") return UNAVAILABLE_GET;
  return { status: "active", entries: result.entries ?? [] };
}

/**
 * זרימת הקריאה:
 * 1. טוקן ריק/חסר -> unavailable מיד, בלי ולידציית payload ובלי לגעת ב-DB.
 * 2. ולידציית מבנה מלאה (validateTrackingPayload) **לפני** כל קריאה ל-DB - עצם תקינות ה-JSON
 *    אינה עובדה רגישת-אבטחה (לא תלויה בטוקן/entitlement), ולכן נבדקת מוקדם ובזול, בלי round-trip
 *    מיותר ל-DB על payload שממילא יידחה.
 * 3. hash את הטוקן, קרא ל-RPC עם הפריטים המאומתים בלבד (לא ה-value הגולמי שהתקבל).
 * 4. outcome==='saved' -> saved. outcome==='invalid_payload' -> invalid_payload (לא אמור לקרות
 *    בפועל, ה-TS כבר סינן - הגנת-עומק). כל דבר אחר (כולל invalid_input) -> unavailable.
 */
export async function saveTrackingData(deps: SaveTrackingDataServiceDeps, request: SaveTrackingDataRequest): Promise<SaveTrackingDataResult> {
  if (!request.rawAccessToken) return UNAVAILABLE_SAVE;

  const validated = validateTrackingPayload(request.entries);
  if (!validated.ok) return INVALID_PAYLOAD;

  const accessTokenHash = await deps.tokenHasher.hashAccessToken(request.rawAccessToken);
  const result = await deps.database.saveTrackingData(request.reportId, accessTokenHash, validated.items);

  if (result.outcome === "saved") return { status: "saved" };
  if (result.outcome === "invalid_payload") return INVALID_PAYLOAD;
  return UNAVAILABLE_SAVE;
}
